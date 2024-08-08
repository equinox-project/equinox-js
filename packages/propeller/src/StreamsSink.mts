import { ITimelineEvent, StreamName, Internal } from "@equinox-js/core"
import { Queue } from "./Queue.js"
import { IngesterBatch, Sink } from "./Types.js"
import { EventHandler, traceHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import EventEmitter from "events"
import { waitForEvent } from "./EventEmitter.js"
import { Semaphore } from "./Semaphore.js"
import { StreamResult } from "./Sinks.js"

const tracer = trace.getTracer("@equinox-js/propeller")

export type StreamSpan = ITimelineEvent[]
type StreamEvent = [StreamName, ITimelineEvent]
export namespace StreamSpan {
  export const idx = (span: StreamSpan): bigint => span[0].index
  export const ver = (span: StreamSpan): bigint => idx(span) + BigInt(span.length)
  export const dropBeforeIndex = (min: bigint, span: StreamSpan): StreamSpan => {
    if (span.length === 0) return []
    if (idx(span) >= min) return span // don't adjust if min not within
    if (ver(span) <= min) return [] // throw away if before min
    return span.slice(Number(min - idx(span)))
  }

  export const merge = (min: bigint, spans: StreamSpan[]): StreamSpan[] => {
    const candidates = Internal.keepMap(spans, (span) => {
      if (span.length === 0) return undefined
      const trimmed = dropBeforeIndex(min, span)
      if (!trimmed || trimmed.length === 0) return undefined
      return trimmed
    })

    if (candidates.length === 0) return []
    if (candidates.length === 1) return candidates
    candidates.sort((a, b) => Number(idx(a) - idx(b)))
    let curr = candidates[0]
    let buffer: StreamSpan[] | null = null
    for (let i = 1; i < candidates.length; i++) {
      const x = candidates[i]
      const index = idx(x)
      const currNext = ver(curr)
      if (index > currNext) {
        // Gap
        if (!buffer) buffer = []
        buffer.push(curr)
        curr = x
      } else if (index + BigInt(x.length) > currNext) {
        // Overlapping, join
        curr = curr.concat(dropBeforeIndex(currNext, x))
      }
    }

    if (!buffer) return [curr]
    buffer.push(curr)
    return buffer
  }
}

class StreamState {
  private static WRITE_POS_UNKNOWN = -2n
  private static WRITE_POS_MALFORMED = -3n

  constructor(
    public write: bigint,
    public queue: StreamSpan[],
  ) {}

  static create(write: bigint | null, queue: StreamSpan[], malformed?: boolean): StreamState {
    if (malformed) return new StreamState(StreamState.WRITE_POS_MALFORMED, queue)
    else if (write === null) return new StreamState(StreamState.WRITE_POS_UNKNOWN, queue)
    return new StreamState(write, queue)
  }

  get isEmpty(): boolean {
    return this.queue.length === 0
  }

  get headSpan(): StreamSpan | null {
    if (this.queue.length === 0) return null
    return this.queue[0]
  }

  get isMalformed(): boolean {
    return !this.isEmpty && this.write === StreamState.WRITE_POS_MALFORMED
  }

  get hasGap(): boolean {
    if (this.write === StreamState.WRITE_POS_UNKNOWN) return false
    return this.write !== this.headSpan![0].index
  }

  get isReady(): boolean {
    return !this.isEmpty && !this.isMalformed
  }

  get writePos(): bigint | null {
    if (this.write === StreamState.WRITE_POS_UNKNOWN) return null
    if (this.write === StreamState.WRITE_POS_MALFORMED) return null
    return this.write
  }

  // Used while constructing a StreamState from a batch of events
  // We allow mutating the queue here as a performance improvement
  // Note that once the newly constructed batch is merged into the
  // "real" state, that will go through the `combine` method
  addEvent(event: ITimelineEvent): void {
    if (this.queue.length === 0) {
      this.queue.push([event])
      return
    }
    if (this.queue.length === 1 && StreamSpan.ver(this.queue[0]) === event.index) {
      this.queue[0].push(event)
      return
    }
    this.queue = StreamSpan.merge(this.write, this.queue.concat([[event]]))
  }

  setWritePos(write: bigint) {
    this.write = write
    this.queue = StreamSpan.merge(write, this.queue)
  }

  combine(s: StreamState) {
    this.write = this.write > s.write ? this.write : s.write
    if (this.isMalformed || s.isMalformed) {
      this.write = StreamState.WRITE_POS_MALFORMED
    }
    const any1 = !this.isEmpty
    const any2 = !s.isEmpty
    if (any1 || any2) {
      const items = any1 && any2 ? this.queue.concat(s.queue) : any1 ? this.queue : s.queue
      this.queue = StreamSpan.merge(this.write, items)
      return
    }
    this.queue = []
  }
}

class Streams {
  private _states = new Map<StreamName, StreamState>()

  merge(name: StreamName, state: StreamState): void {
    const curr = this._states.get(name)
    if (!curr) this._states.set(name, state)
    else curr.combine(state)
  }

  addEvent(name: StreamName, event: ITimelineEvent): void {
    const curr = this._states.get(name)
    if (!curr) this._states.set(name, StreamState.create(null, [[event]]))
    else curr.addEvent(event)
  }

  get states() {
    return this._states.entries()
  }
}

class Batch {
  constructor(
    public readonly onComplete: () => void,
    public requests: Map<StreamName, bigint>,
  ) {}

  static create(onComplete: () => void, streamEvents: StreamEvent[]) {
    const streams = new Streams()
    const requests = new Map<StreamName, bigint>()
    for (const [name, event] of streamEvents) {
      streams.addEvent(name, event)
      const current = requests.get(name)
      const required = event.index + 1n
      if (!current || current < required) requests.set(name, required)
    }
    return [streams, new Batch(onComplete, requests)] as const
  }

  get reqs() {
    return this.requests.entries()
  }
}

class StreamStates {
  private states = new Map<StreamName, StreamState>()
  private busy = new Set<StreamName>()

  private merge(name: StreamName, state: StreamState): void {
    const curr = this.states.get(name)
    if (!curr) this.states.set(name, state)
    else curr.combine(state)
  }

  private markCompleted(name: StreamName, write: bigint): void {
    const curr = this.states.get(name)
    if (!curr) this.states.set(name, StreamState.create(write, []))
    else curr.setWritePos(write)
  }

  markBusy(name: StreamName): void {
    this.busy.add(name)
  }

  markIdle(name: StreamName): void {
    this.busy.delete(name)
  }

  chooseDispatchable(name: StreamName, allowGaps: boolean): StreamState | null {
    if (this.busy.has(name)) return null
    const state = this.states.get(name)
    if (!state) return null
    if (state.isReady && (allowGaps || !state.hasGap)) return state
    return null
  }

  writePositionIsAlreadyBeyond(name: StreamName, write: bigint): boolean {
    const state = this.states.get(name)
    if (!state) return false
    if (state.writePos === null) return false
    return state.writePos >= write
  }

  mergeStreams(streams: Streams): void {
    for (const [name, state] of streams.states) {
      this.merge(name, state)
    }
  }

  recordProgress(stream: StreamName, write: bigint): void {
    this.markIdle(stream)
    this.markCompleted(stream, write)
  }
}

type BatchState = { markCompleted: () => void; streamToRequiredIndex: Map<StreamName, bigint> }

class ProgressState {
  private pending = new Queue<BatchState>()

  private trim() {
    while (this.pending.size > 0 && this.pending.peek()!.streamToRequiredIndex.size === 0) {
      this.pending.tryGet()!.markCompleted()
    }
  }

  appendBatch(markCompleted: () => void, streamToRequiredIndex: Map<StreamName, bigint>) {
    const fresh = { markCompleted, streamToRequiredIndex }
    this.pending.add(fresh)
    this.trim()
    if (this.pending.size === 0) return null
    return fresh
  }

  markStreamProgress(stream: StreamName, index: bigint) {
    for (const batch of this.pending) {
      const requiredIndex = batch.streamToRequiredIndex.get(stream)
      if (requiredIndex === undefined) continue
      if (requiredIndex <= index) batch.streamToRequiredIndex.delete(stream)
    }
    this.trim()
  }

  enumPending(): Iterable<BatchState> {
    return this.pending
  }
}

class StreamsPrioritizer {
  streamsSuggested = new Set<StreamName>()

  private *collectUniqueStreams(xs: Iterable<BatchState>) {
    for (const batch of xs) {
      for (const stream of batch.streamToRequiredIndex.keys()) {
        if (!this.streamsSuggested.has(stream)) {
          this.streamsSuggested.add(stream)
          yield stream
        }
      }
    }
  }

  collectStreams(batches: Iterable<BatchState>): Iterable<StreamName> {
    this.streamsSuggested.clear()
    return this.collectUniqueStreams(batches)
  }
}

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
  private streams = new StreamStates()
  private batches = new ProgressState()
  private prioritizer = new StreamsPrioritizer()
  private sem: Semaphore
  private processOnNextTick = createNextTickScheduler(() => this.processMessages())

  constructor(
    private readonly concurrency: number,
    private readonly computation: EventHandler<string>,
    private readonly allowGaps: boolean,
    private readonly signal: AbortSignal,
  ) {
    this.sem = new Semaphore(this.concurrency)
  }

  post(onComplete: () => void, ingesterBatch: IngesterBatch) {
    const [streams, batch] = Batch.create(onComplete, ingesterBatch.items)
    const reqs = new Map<StreamName, bigint>()
    for (const [sn, pos] of batch.reqs) {
      if (!this.streams.writePositionIsAlreadyBeyond(sn, pos)) {
        reqs.set(sn, pos)
      }
    }
    if (reqs.size === 0) return onComplete()
    this.streams.mergeStreams(streams)
    this.batches.appendBatch(batch.onComplete, reqs)
    this.processOnNextTick()
  }

  processMessages(): void {
    if (this.signal.aborted) return
    const streamsToProcess = this.prioritizer.collectStreams(this.batches.enumPending())

    for (const stream of streamsToProcess) {
      const span = this.streams.chooseDispatchable(stream, this.allowGaps)?.headSpan
      if (!span) continue
      if (!this.sem.tryTake()) return
      this.streams.markBusy(stream)
      // the span can be mutated during the computation, so we make a copy
      const events = span.slice()

      // NOTE: We explcitly do not catch errors here because we want to crash
      // the process if the handler throws. As such, it is up to the end-user
      // to avoid throwing and instead handle exceptions in the handler itself.
      // CAUTION: If the end-user has set up an unhandledRejection handler, it
      // will keep the process alive and the dispatcher will have lost track of
      // the semaphore, potentially causing it to stop processing.
      this.computation(stream, events).then((result) => {
        const nextIndex = StreamResult.toIndex(events, result ?? StreamResult.AllProcessed)
        this.batches.markStreamProgress(stream, nextIndex)
        this.streams.recordProgress(stream, nextIndex)
        this.sem.release()
        this.processOnNextTick()
      })
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
  handler: EventHandler<string>
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

export class StreamsSink implements Sink {
  private events = new EventEmitter()
  private readonly handler: EventHandler<string>
  private dispatcher!: ConcurrentDispatcher
  private tracingAttrs: Attributes

  constructor(
    handler: EventHandler<string>,
    private readonly maxConcurrentStreams: number,
    private readonly limiter: BatchLimiter,
    private requireCompleteStreams = false,
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

  private onNextError(handler: (err: Error) => void) {}

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
    this.dispatcher = new ConcurrentDispatcher(
      this.maxConcurrentStreams,
      async (stream, events) =>
        this.handler(stream, events).catch((err) => {
          this.events.emit("error", err)
        }),
      !this.requireCompleteStreams,
      signal,
    )
    return this.waitForErrorOrAbort(signal)
  }

  waitForErrorOrAbort(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        // avoid leaking the closure
        this.events.off("error", reject)
        resolve()
      }
      const onError = (err: Error) => {
        signal.removeEventListener("abort", onAbort)
        reject(err)
      }
      this.events.once("error", onError)
      signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  // prettier-ignore
  static create({ handler, maxReadAhead, maxConcurrentStreams, requireCompleteStreams, tracingAttrs }: CreateOptions) {
    const limiter = new BatchLimiter(maxReadAhead)
    return new StreamsSink(handler, maxConcurrentStreams, limiter, requireCompleteStreams, tracingAttrs)
  }
}
