import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { IngesterBatch, Sink } from "./Types.js"
import { EventHandler, traceHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import EventEmitter from "events"
import { waitForEvent } from "./EventEmitter.js"
import { Semaphore } from "./Semaphore.js"

const tracer = trace.getTracer("@equinox-js/propeller")

export type StreamSpan = ITimelineEvent[]

const createNextTickScheduler = (f: () => void) => {
  let isPending = false
  return () => {
    if (isPending) return
    isPending = true
    process.nextTick(() => {
      isPending = false
      f()
    })
  }
}

class ConcurrentDispatcher {
  private batches: Array<{ onComplete: () => void; items: Map<StreamName, ITimelineEvent[]> }> = []
  private inflight = new Set<StreamName>()
  private sem: Semaphore
  private processOnNextTick = createNextTickScheduler(() => this.processMessages())

  constructor(
    private readonly concurrency: number,
    private readonly computation: EventHandler<string, void>,
    private readonly signal: AbortSignal,
  ) {
    this.sem = new Semaphore(this.concurrency)
  }

  post(onComplete: () => void, ingesterBatch: IngesterBatch) {
    const byStream = new Map<StreamName, StreamSpan>()
    for (const [sn, event] of ingesterBatch.items) {
      const span = byStream.get(sn)
      if (!span) byStream.set(sn, [event])
      else span.push(event)
    }
    if (byStream.size === 0) return onComplete()
    this.batches.push({ onComplete, items: byStream })
    this.processOnNextTick()
  }

  processMessages(): void {
    if (this.signal.aborted) return
    for (const batch of this.batches) {
      for (const [sn, span] of batch.items) {
        if (!this.sem.tryTake()) return
        if (this.inflight.has(sn)) continue
        this.inflight.add(sn)

        // NOTE: We explcitly do not catch errors here because we want to crash
        // the process if the handler throws. As such, it is up to the end-user
        // to avoid throwing and instead handle exceptions in the handler itself.
        // CAUTION: If the end-user has set up an unhandledRejection handler, it
        // will keep the process alive and the dispatcher will have lost track of
        // the semaphore, potentially causing it to stop processing.
        this.computation(sn, span)
          .then(() => {
            this.inflight.delete(sn)
            batch.items.delete(sn)
            if (batch.items.size === 0) {
              batch.onComplete()
              this.batches.shift()
            }
            this.sem.release()
            this.processOnNextTick()
          })
          .catch((_err) => {
            // do nothing here, it's already been handled by streamssink
          })
      }
    }
  }
}

export class BatchLimiter {
  private inProgressBatches = 0
  private events = new EventEmitter()

  constructor(public maxReadAhead: number) {}

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
  handler: EventHandler<string, void>
  /** The maximum number of streams that can be processing concurrently
   * Note: each stream can have at most 1 handler active */
  maxConcurrentStreams: number
  /** The number of batches the source can read ahead the currently processing batch */
  maxReadAhead: number
  /** Where events are potentially delivered out of order, wait for first event until write position is known
   * Note, this should likely only be used when replaying from scratch, At Least Once semantics mean that this
   * option can brick your processing when you start up and receive an old event as your first event for the stream
   * e.g. 1,2,3 -- restart -- 1,4,5
   * default: false */
  requireCompleteStreams?: boolean
  /** Attributes to add to every span */
  tracingAttrs?: Attributes
}

export class SimpleSink implements Sink {
  private readonly handler: EventHandler<string, void>
  private dispatcher!: ConcurrentDispatcher
  private tracingAttrs: Attributes

  constructor(
    handler: EventHandler<string, void>,
    private readonly maxConcurrentStreams: number,
    private readonly limiter: BatchLimiter,
    tracingAttrs: Attributes = {},
  ) {
    this.tracingAttrs = Object.assign(
      {
        "eqx.max_concurrent_streams": maxConcurrentStreams,
        "eqx.max_read_ahead": limiter.maxReadAhead,
      },
      tracingAttrs,
    )
    this.handler = traceHandler(tracer, this.tracingAttrs, handler)
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  pump(ingesterBatch: IngesterBatch, signal: AbortSignal): void | Promise<void> {
    this.limiter.startBatch()
    const onComplete = () => {
      ingesterBatch.onComplete()
      this.limiter.endBatch()
    }
    this.dispatcher.post(onComplete, ingesterBatch)
    return this.limiter.waitForCapacity(signal)
  }

  async start(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        resolve()
      }
      const onError = (err: Error) => {
        signal.removeEventListener("abort", onAbort)
        reject(err)
      }
      this.dispatcher = new ConcurrentDispatcher(
        this.maxConcurrentStreams,
        async (stream, events) =>
          this.handler(stream, events).catch((err) => {
            onError(err)
            throw err
          }),
        signal,
      )

      signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  // prettier-ignore
  static create({ handler, maxReadAhead, maxConcurrentStreams, tracingAttrs }: CreateOptions) {
    const limiter = new BatchLimiter(maxReadAhead)
    return new StreamsSink(handler, maxConcurrentStreams, limiter, tracingAttrs)
  }
}
