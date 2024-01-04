import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { traceHandler, EventHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import { IngesterBatch, Sink } from "./Types.js"
import { MailboxProcessor } from "./MailboxProcessor.js"
import { Async, CancellationToken } from "./Async.js"
import { createHash } from "crypto"

const tracer = trace.getTracer("@equinox-js/propeller")

class Stream {
  events: ITimelineEvent[] = []
  constructor(public name: StreamName) {}

  merge(event: ITimelineEvent): void {
    const last = this.events[this.events.length - 1]
    if (last && last.index >= event.index) return
    this.events.push(event)
  }
}

namespace QWorker {
  export const create = (
    handler: EventHandler<string>,
    tracingAttrs: Attributes,
    onHandled: (stream: Stream) => void,
    token: CancellationToken,
  ) => {
    const mb = MailboxProcessor.start<Stream>((mb) => {
      return Async.do(function* loop(): Async<void> {
        const stream = yield mb.receive()
        yield Async.awaitPromise(
          traceHandler(tracer, tracingAttrs, stream.name, stream.events, handler),
        )
        onHandled(stream)
        yield* loop()
      })
    }, token)

    return mb
  }
}

export class BatchLimiter {
  private inProgressBatches = 0
  private onReady?: () => void
  private onEmpty?: () => void
  constructor(private maxReadAhead: number) {}

  waitForCapacity(signal: AbortSignal) {
    if (this.inProgressBatches < this.maxReadAhead) return
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort)
        reject(new Error("Aborted"))
      }
      signal.addEventListener("abort", abort)
      this.onReady = () => {
        signal.removeEventListener("abort", abort)
        resolve()
      }
    })
  }

  waitForEmpty() {
    if (this.inProgressBatches === 0) return
    return new Promise<void>((resolve) => {
      this.onEmpty = () => {
        resolve()
      }
    })
  }

  startBatch() {
    this.inProgressBatches++
  }

  endBatch() {
    this.inProgressBatches--
    this.onReady?.()
    delete this.onReady
    if (this.inProgressBatches === 0) {
      this.onEmpty?.()
      delete this.onEmpty
    }
  }
}

type CreateOptions = {
  /** The handler to call for each batch of stream messages */
  handler: EventHandler<string>
  /** The maximum number of streams that can be processing concurrently
   * Note: each stream can have at most 1 handler active */
  maxConcurrentStreams: number
  /** The number of batches the source can read ahead the currently processing batch */
  maxReadAhead: number
  /** Attributes to add to every span */
  tracingAttrs?: Attributes
}

class Dispatcher {
  workers: MailboxProcessor<Stream>[] = []
  queue: Stream[] = []
  streamMap = new Map<StreamName, MailboxProcessor<Stream>>()
  constructor(
    private workerCount: number,
    private handler: EventHandler<string>,
    private tracingAttrs: Attributes,
    private onHandled: (stream: Stream) => void,
  ) {}

  start(signal: AbortSignal) {
    const token = CancellationToken.ofAbortSignal(signal)
    this.workers = Array.from({ length: this.workerCount }, () =>
      QWorker.create(this.handler, this.tracingAttrs, this.onHandled, token),
    )
    for (const stream of this.queue) {
      this.pump(stream)
    }
    this.queue = []
    // Starts N workers that will process streams in parallel
    return new Promise<void>((resolve, reject) => {
      for (const mb of this.workers) {
        mb.events.once("error", (err) => {
          reject(err)
          token.cancel()
        })
      }
      token.addListener(() => resolve())
    })
  }

  pump(stream: Stream) {
    if (this.workers.length === 0) {
      this.queue.push(stream)
      return
    }
    const hash =
      createHash("md5").update(stream.name).digest().readUInt32BE(0) % this.workers.length
    const worker = this.workers[hash]
    worker.post(stream)
  }
}

export class StreamsSink implements Sink {
  private streams = new Map<StreamName, Stream>()
  private activeStreams = new Set<StreamName>()
  private streamPositions = new Map<StreamName, bigint>()
  private batchStreams = new Map<IngesterBatch, Map<StreamName, bigint>>()
  private readonly tracingAttrs: Attributes = {}
  dispatcher: Dispatcher

  constructor(
    private readonly handle: EventHandler<string>,
    private maxConcurrentStreams: number,
    private readonly batchLimiter: BatchLimiter,
  ) {
    this.addTracingAttrs({ "eqx.max_concurrent_streams": maxConcurrentStreams })
    this.dispatcher = new Dispatcher(
      this.maxConcurrentStreams,
      this.handle,
      this.tracingAttrs,
      this.handleStreamCompletion.bind(this),
    )
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  private handleStreamCompletion(stream: Stream) {
    const index = stream.events[0].index + BigInt(stream.events.length)
    this.activeStreams.delete(stream.name)
    const batches = Array.from(this.batchStreams)
    for (const [batch, streams] of this.batchStreams) {
      const requiredIndex = streams.get(stream.name) ?? -1n
      if (requiredIndex <= index) streams.delete(stream.name)
      if (streams.size === 0 && batches[0][0] === batch) {
        batches.shift()
        batch.onComplete()
        this.batchStreams.delete(batch)
        this.batchLimiter.endBatch()
      }
    }
  }

  async start(signal: AbortSignal) {
    // set up a linked abort controller to avoid attaching too many event listeners to the provided signal
    // node has a default limit of 11 before it emits a warning to the console. We have entirely legitimate reasons
    // for attaching more than 11 listeners

    return this.dispatcher.start(signal)
  }

  async pump(batch: IngesterBatch, signal: AbortSignal): Promise<void> {
    this.batchLimiter.startBatch()
    const streamsInBatch = new Map<StreamName, bigint>()
    this.batchStreams.set(batch, streamsInBatch)
    for (const [sn, event] of batch.items) {
      const current = this.streams.get(sn)
      const stream = current ?? new Stream(sn)
      stream.merge(event)
      const curr = streamsInBatch.get(sn) ?? -1n
      if (curr < event.index) streamsInBatch.set(sn, event.index)
      if (!current) {
        this.streams.set(sn, stream)
        this.dispatcher.pump(stream)
      }
    }
    await this.batchLimiter.waitForCapacity(signal)
  }

  static create(options: CreateOptions) {
    const limiter = new BatchLimiter(options.maxReadAhead)
    const sink = new StreamsSink(options.handler, options.maxConcurrentStreams, limiter)
    if (options.tracingAttrs) sink.addTracingAttrs(options.tracingAttrs)
    return sink
  }
}
