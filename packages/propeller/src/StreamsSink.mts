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

function waitForEvent(emitter: EventEmitter, event: string, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => emitter.once(event, () => resolve()))
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(new Error("Aborted"))
    }
    signal.addEventListener("abort", abort)
    emitter.once(event, () => {
      signal.removeEventListener("abort", abort)
      resolve()
    })
  })
}

export class BatchLimiter {
  private inProgressBatches = 0
  private events = new EventEmitter()
  constructor(private maxReadAhead: number) {}

  waitForCapacity(signal: AbortSignal): Promise<void> | void {
    if (this.inProgressBatches < this.maxReadAhead) return
    return waitForEvent(this.events, "ready", signal)
  }

  async waitForEmpty() {
    if (this.inProgressBatches === 0) return 
    await waitForEvent(this.events, "empty")
  }

  startBatch() {
    this.inProgressBatches++
  }

  endBatch() {
    this.inProgressBatches--
    this.events.emit("ready")
    if (this.inProgressBatches === 0) this.events.emit("empty")
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
  private events = new EventEmitter()
  private readonly handler: EventHandler<string>
  private dispatcher!: ConcurrentDispatcher
  private tracingAttrs: Attributes
  constructor(
    handler: EventHandler<string>,
    private readonly maxConcurrentStreams: number,
    private readonly batchLimiter: BatchLimiter,
    tracingAttrs: Attributes = {},
  ) {
    this.tracingAttrs = Object.assign({ "eqx.max_read_ahead": maxConcurrentStreams }, tracingAttrs)
    this.handler = traceHandler(tracer, this.tracingAttrs, handler)
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  onError(handler: (err: Error) => void) {
    this.events.on("error", handler)
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

  pump(batch: IngesterBatch, signal: AbortSignal): void | Promise<void> {
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
    return this.batchLimiter.waitForCapacity(signal)
  }

  async start(signal: AbortSignal) {
    this.dispatcher = new ConcurrentDispatcher(
      this.maxConcurrentStreams,
      async (stream) => {
        // once we start handling a stream we do not want to merge more events into it
        this.streams.delete(stream.name)
        try {
          await this.handler(stream.name, stream.events)
          return this.handleStreamCompletion(stream)
        } catch (err) {
          this.events.emit("error", err)
        }
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

  static create({ handler, maxReadAhead, maxConcurrentStreams, tracingAttrs }: CreateOptions) {
    const limiter = new BatchLimiter(maxReadAhead)
    const sink = new StreamsSink(handler, maxConcurrentStreams, limiter, tracingAttrs)
    return sink
  }
}
