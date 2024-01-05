import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { traceHandler, EventHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import { IngesterBatch, Sink } from "./Types.js"
import { Queue } from "./Queue.js"
import EventEmitter from "node:events"

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

class ConcurrentDispatcher {
  private active = new Set<StreamName>()
  private queue = new Queue<Stream>()
  private delayed = new Map<StreamName, Queue<Stream>>()
  constructor(
    private readonly concurrency: number,
    private readonly computation: (stream: Stream) => Promise<void>,
    private readonly signal: AbortSignal,
  ) {}

  post(stream: Stream) {
    this.queue.add(stream)
    process.nextTick(() => this.processMessages())
  }

  private delayActive(stream: Stream) {
    if (this.active.has(stream.name)) {
      if (!this.delayed.has(stream.name)) this.delayed.set(stream.name, new Queue<Stream>())
      this.delayed.get(stream.name)!.add(stream)
      this.processMessages()
      return true
    }
  }

  private reintroduceDelayed(stream: Stream) {
    const q = this.delayed.get(stream.name)
    if (!q) return
    this.queue.prepend(q.tryGet()!)
    if (q.size === 0) this.delayed.delete(stream.name)
  }

  processMessages(): void {
    if (this.signal.aborted) return
    if (this.active.size >= this.concurrency) return
    const stream = this.queue.tryGet()
    if (!stream) return
    if (this.delayActive(stream)) return

    this.active.add(stream.name)
    this.computation(stream).finally(() => {
      this.reintroduceDelayed(stream)
      this.active.delete(stream.name)
      this.processMessages()
    })
    if (this.active.size < this.concurrency) this.processMessages()
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

export class StreamsSink implements Sink {
  private streams = new Map<StreamName, Stream>()
  private batchStreams = new Map<IngesterBatch, Set<Stream>>()
  private readonly tracingAttrs: Attributes = {}
  private events = new EventEmitter()
  private readonly handler: EventHandler<string>
  private dispatcher!: ConcurrentDispatcher
  constructor(
    handler: EventHandler<string>,
    private readonly maxConcurrentStreams: number,
    private readonly batchLimiter: BatchLimiter,
  ) {
    this.addTracingAttrs({ "eqx.max_concurrent_streams": maxConcurrentStreams })
    this.handler = traceHandler(tracer, this.tracingAttrs, handler)
  }

  onError(handler: (err: Error) => void) {
    this.events.on("error", handler)
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  private handleStreamCompletion(stream: Stream) {
    const batches = Array.from(this.batchStreams)
    for (const [batch, streams] of this.batchStreams) {
      streams.delete(stream)
      if (streams.size === 0 && batches[0][0] === batch) {
        batches.shift()
        batch.onComplete()
        this.batchStreams.delete(batch)
        this.batchLimiter.endBatch()
      }
    }
  }

  async pump(batch: IngesterBatch, signal: AbortSignal): Promise<void> {
    this.batchLimiter.startBatch()
    const streamsInBatch = new Set<Stream>()
    this.batchStreams.set(batch, streamsInBatch)
    for (const [sn, event] of batch.items) {
      const current = this.streams.get(sn)
      const stream = current ?? new Stream(sn)
      stream.merge(event)
      streamsInBatch.add(stream)
      if (!current) {
        this.streams.set(sn, stream)
        this.dispatcher.post(stream)
      }
    }
    await this.batchLimiter.waitForCapacity(signal)
  }

  async start(signal: AbortSignal) {
    this.dispatcher = new ConcurrentDispatcher(
      this.maxConcurrentStreams,
      (stream) => {
        // once we start handling a stream we do not want to merge more events into it
        this.streams.delete(stream.name)
        return this.handler(stream.name, stream.events)
          .then(() => this.handleStreamCompletion(stream))
          .catch((err) => {
            this.events.emit("error", err)
          })
      },
      signal,
    )
    return this.waitForErrorOrAbort(signal)
  }

  waitForErrorOrAbort(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      this.onError(reject)
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
  }

  static create(options: CreateOptions) {
    const limiter = new BatchLimiter(options.maxReadAhead)
    const sink = new StreamsSink(options.handler, options.maxConcurrentStreams, limiter)
    if (options.tracingAttrs) sink.addTracingAttrs(options.tracingAttrs)
    return sink
  }
}
