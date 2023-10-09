import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { traceHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import { IngesterBatch, Sink, EventHandler } from "./Types.js"
import { AsyncQueue } from "./Queue.js"

const tracer = trace.getTracer("@equinox-js/propeller")

type StreamBatch = { checkpoint: bigint; events: ITimelineEvent[] }

class Stream {
  batches: StreamBatch[] = []
  handledIndex = -1n
  checkpoint = -1n
  isHandling = false
  constructor(
    public name: StreamName,
    public handle: EventHandler<string>,
    public tracingAttrs: Attributes,
  ) {}

  mergeBatch(checkpoint: bigint, events: ITimelineEvent[]): void {
    if (checkpoint <= this.checkpoint) return
    this.batches.push({ checkpoint, events })
  }

  async run() {
    if (this.batches.length === 0) return
    const events = this.batches.flatMap((b) => b.events).filter((x) => x.index > this.handledIndex)
    if (events.length === 0) return
    try {
      this.isHandling = true
      const checkpoint = this.batches[this.batches.length - 1].checkpoint

      await traceHandler(tracer, this.tracingAttrs, this.name, events, this.handle)
      this.batches = this.batches.filter((b) => b.checkpoint > checkpoint)
      this.checkpoint = checkpoint
      this.handledIndex = events[events.length - 1].index
    } finally {
      this.isHandling = false
    }
  }
}

class QueueWorker {
  private stopped = true
  constructor(
    private readonly tryGetNext: (signal: AbortSignal) => Promise<Stream>,
    private readonly onHandled: (stream: Stream) => void,
  ) {}

  stop() {
    this.stopped = true
  }

  async run(signal: AbortSignal): Promise<void> {
    this.stopped = false
    while (!signal.aborted && !this.stopped) {
      const stream = await this.tryGetNext(signal)
      await stream.run()
      this.onHandled(stream)
    }
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
        reject(signal.reason)
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
  private queue = new AsyncQueue<Stream>()
  private streams = new Map<StreamName, Stream>()
  private batchStreams = new Map<IngesterBatch, Set<Stream>>()
  private readonly tracingAttrs: Attributes = {}
  constructor(
    private readonly handle: EventHandler<string>,
    private maxConcurrentStreams: number,
    private readonly batchLimiter: BatchLimiter,
  ) {
    this.addTracingAttrs({ "eqx.max_concurrent_streams": maxConcurrentStreams })
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
    if (stream.batches.length) {
      this.queue.add(stream)
    }
  }

  async start(signal: AbortSignal) {
    // Starts N workers that will process streams in parallel
    const workers = new Array<QueueWorker>(this.maxConcurrentStreams)

    for (let i = 0; i < this.maxConcurrentStreams; ++i) {
      workers[i] = new QueueWorker(
        async (signal) => this.queue.tryFindAsync((stream) => !stream.isHandling, signal),
        (stream) => this.handleStreamCompletion(stream),
      )
    }

    try {
      await Promise.all(workers.map((w) => w.run(signal)))
    } catch (err) {
      workers.forEach((w) => w.stop())
      throw err
    }
  }

  async pump(batch: IngesterBatch, signal: AbortSignal): Promise<void> {
    this.batchLimiter.startBatch()
    const streamsInBatch = new Set<Stream>()
    this.batchStreams.set(batch, streamsInBatch)
    const grouped = new Map<StreamName, ITimelineEvent[]>()
    for (const [sn, event] of batch.items) {
      const current = grouped.get(sn)
      if (current) {
        current.push(event)
      } else {
        grouped.set(sn, [event])
      }
    }
    for (const [sn, events] of grouped) {
      const current = this.streams.get(sn)
      const stream = current ?? new Stream(sn, this.handle, this.tracingAttrs)
      stream.mergeBatch(batch.checkpoint, events)
      streamsInBatch.add(stream)
      if (!current) {
        this.streams.set(sn, stream)
        this.queue.add(stream)
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
