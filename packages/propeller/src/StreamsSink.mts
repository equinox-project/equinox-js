import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { traceHandler, EventHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import { IngesterBatch, Sink } from "./Types.js"
import { AsyncQueue } from "./Queue.js"

const tracer = trace.getTracer("@equinox-js/propeller")

class Stream {
  events: ITimelineEvent[] = []
  constructor(public name: StreamName) {}

  merge(event: ITimelineEvent): void {
    const last = this.events[this.events.length - 1]
    if (!last || last.index === event.index - 1n) {
      this.events.push(event)
      return
    }
    if (last.index > event.index) return
    if (event.index > last.index) throw new Error("Unexpected gap")
  }
}

class QueueWorker {
  private stopped = true
  constructor(
    private readonly tryGetNext: (signal: AbortSignal) => Promise<Stream>,
    private readonly handle: EventHandler<string>,
    private readonly tracingAttrs: Attributes,
    private readonly onHandled: (stream: Stream) => void,
  ) {}

  stop() {
    this.stopped = true
  }

  async run(signal: AbortSignal): Promise<void> {
    this.stopped = false
    while (!signal.aborted && !this.stopped) {
      const stream = await this.tryGetNext(signal)
      await traceHandler(tracer, this.tracingAttrs, stream.name, stream.events, this.handle)
      this.onHandled(stream)
    }
  }
}

export class BatchLimiter {
  private inProgressBatches = 0
  private onReady?: () => void
  private onEmpty?: () => void
  constructor(private maxConcurrentBatches: number) {}

  waitForCapacity(signal: AbortSignal) {
    if (this.inProgressBatches < this.maxConcurrentBatches) return
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
    console.debug("Starting batch")
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

export class StreamsSink implements Sink {
  private queue = new AsyncQueue<Stream>()
  private streams = new Map<StreamName, Stream>()
  private activeStreams = new Set<StreamName>()
  private batchStreams = new Map<IngesterBatch, Set<Stream>>()
  constructor(
    private readonly handle: EventHandler<string>,
    private maxConcurrentStreams: number,
    private readonly batchLimiter: BatchLimiter,
    private readonly tracingAttrs: Attributes = {},
  ) {
    this.addTracingAttrs({ "eqx.max_concurrent_streams": maxConcurrentStreams })
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  private handleStreamCompletion(stream: Stream) {
    this.activeStreams.delete(stream.name)
    for (const [batch, streams] of this.batchStreams) {
      streams.delete(stream)
      if (streams.size === 0) {
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
    const ctrl = new AbortController()
    signal.addEventListener("abort", () => ctrl.abort())
    const _signal = ctrl.signal
    // Starts N workers that will process streams in parallel

    const workers = new Array<QueueWorker>(this.maxConcurrentStreams)

    for (let i = 0; i < this.maxConcurrentStreams; ++i) {
      workers[i] = new QueueWorker(
        async (signal) => {
          const stream = await this.queue.tryFindAsync(
            (stream) => !this.activeStreams.has(stream.name),
            signal,
          )
          this.activeStreams.add(stream.name)
          this.streams.delete(stream.name)
          return stream
        },
        this.handle,
        this.tracingAttrs,
        (stream) => this.handleStreamCompletion(stream),
      )
    }

    try {
      await Promise.all(workers.map((w) => w.run(_signal)))
    } catch (err) {
      workers.forEach((w) => w.stop())
      throw err
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
        this.queue.add(stream)
      }
    }
    await this.batchLimiter.waitForCapacity(signal)
  }

  static create(
    handle: EventHandler<string>,
    maxConcurrentStreams: number,
    maxConcurrentBatches: number,
    tracingAttrs: Attributes = {},
  ) {
    const limiter = new BatchLimiter(maxConcurrentBatches)
    return new StreamsSink(handle, maxConcurrentStreams, limiter, tracingAttrs)
  }
}
