import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { keepMap } from "./Array.js"
import { Queue } from "./Queue.js"
import { IngesterBatch, Sink } from "./Types.js"
import { EventHandler, traceHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import EventEmitter from "events"
import { waitForEvent } from "./EventEmitter.js"
import { Semaphore } from "./Semaphore.js"
import { StreamResult } from "./Sinks.js"

const tracer = trace.getTracer("@equinox-js/propeller")

type StreamSpan = ITimelineEvent[]
type StreamEvent = [StreamName, ITimelineEvent]
namespace StreamSpan {
  export const idx = (span: StreamSpan): bigint => span[0].index
  export const ver = (span: StreamSpan): bigint => idx(span) + BigInt(span.length)
  export const dropBeforeIndex = (min: bigint, span: StreamSpan): StreamSpan => {
    if (span.length === 0) return []
    if (idx(span) >= min) return span // don't adjust if min not within
    if (ver(span) <= min) return [] // throw away if before min
    return span.slice(Number(min - idx(span)))
  }

  export const merge = (min: bigint, spans: StreamSpan[]): StreamSpan[] => {
    const candidates = keepMap(spans, (span) => {
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
    return this.write === this.headSpan![0].index
  }

  get isReady(): boolean {
    return !this.isEmpty && !this.isMalformed
  }

  get writePos(): bigint | null {
    if (this.write === StreamState.WRITE_POS_UNKNOWN) return null
    if (this.write === StreamState.WRITE_POS_MALFORMED) return null
    return this.write
  }

  static combine(s1: StreamState, s2: StreamState): StreamState {
    const writePos = s1.write > s2.write ? s1.write : s2.write
    const malformed = s1.isMalformed || s2.isMalformed
    const any1 = !s1.isEmpty
    const any2 = !s2.isEmpty
    if (any1 || any2) {
      const items = any1 && any2 ? s1.queue.concat(s2.queue) : any1 ? s1.queue : s2.queue
      return StreamState.create(writePos, StreamSpan.merge(writePos, items), malformed)
    }
    return StreamState.create(writePos, [], malformed)
  }
}

class Streams {
  private _states = new Map<StreamName, StreamState>()

  merge(name: StreamName, state: StreamState): void {
    const curr = this._states.get(name)
    if (!curr) this._states.set(name, state)
    else this._states.set(name, StreamState.combine(curr, state))
  }

  addEvent(name: StreamName, event: ITimelineEvent): void {
    this.merge(name, StreamState.create(null, [[event]]))
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
    else this.states.set(name, StreamState.combine(curr, state))
  }

  private markCompleted(name: StreamName, write: bigint): void {
    this.merge(name, StreamState.create(write, []))
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
      const events = this.streams.chooseDispatchable(stream, true)?.headSpan
      if (!events) continue
      if (!this.sem.tryTake()) return
      this.streams.markBusy(stream)
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
  private events = new EventEmitter()
  private readonly handler: EventHandler<string>
  private dispatcher!: ConcurrentDispatcher
  private tracingAttrs: Attributes
  constructor(
    handler: EventHandler<string>,
    private readonly maxConcurrentStreams: number,
    private readonly limiter: BatchLimiter,
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
      async (stream, events) => {
        try {
          return await this.handler(stream, events)
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
