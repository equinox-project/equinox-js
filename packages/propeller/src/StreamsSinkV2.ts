import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { keepMap } from "./Array.js"
import { Queue } from "./Queue.js"

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

  get canPurge(): boolean {
    return this.isEmpty
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

  combine(other: Streams) {
    for (const [name, state] of other._states.entries()) {
      this.merge(name, state)
    }
  }

  get states() {
    return this._states.entries()
  }
}

class Batch {
  constructor(
    public readonly onComplete: () => void,
    private requests: Map<StreamName, bigint>,
  ) {}
  static create(onComplete: () => void, streamEvents: StreamEvent[]) {
    const streams = new Streams()
    const requests = new Map<StreamName, bigint>()
    for (const [name, event] of streamEvents) {
      streams.merge(name, StreamState.create(event.index, [[event]]))
      const current = requests.get(name)
      const required = event.index + 1n
      if (!current || current < required) requests.set(name, required)
    }
    return [streams, new Batch(onComplete, requests)] as const
  }

  get reqs() {
    return this.requests.entries()
  }

  get streamsCount() {
    return this.requests.size
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

  private updateWritePos(
    name: StreamName,
    isMalformed: boolean,
    write: bigint | null,
    span: StreamSpan[],
  ): void {
    this.merge(name, StreamState.create(write, span, isMalformed))
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

  recordWriteProgress(name: StreamName, write: bigint, queue: StreamSpan[]): void {
    this.merge(name, StreamState.create(write, queue))
  }

  setMalformed(name: StreamName, malformed: boolean): void {
    this.updateWritePos(name, malformed, null, [])
  }

  purge() {
    let purged = 0
    for (const [name, state] of this.states.entries()) {
      if (!state.canPurge) continue
      this.states.delete(name)
      purged++
    }
    return { remaining: this.states.size, purged }
  }

  recordProgress(stream: StreamName, write: bigint): void {
    this.markIdle(stream)
    this.markCompleted(stream, write)
  }

  recordNoProgress(stream: StreamName): void {
    this.markIdle(stream)
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

  get runningCount() {
    return this.pending.size
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

  *enumPending(): Iterable<BatchState> {
    yield* this.pending
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
    return this.collectUniqueStreams(batches)
  }
}

class Engine {
  private streams = new StreamStates()
  private batches = new ProgressState()

  private enumBatches() {
    return this.batches.enumPending()
  }

  constructor(
    dispatcher: ConcurrentDispatcher,
  ) {}
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
