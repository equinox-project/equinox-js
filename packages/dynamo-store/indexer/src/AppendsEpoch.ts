/**
 * Maintains a sequence of Ingested StreamSpans representing groups of stream writes that were indexed at the same time
 * Ingestion takes care of deduplicating each batch of writes with reference to the existing spans recorded for this Epoch (only)
 * When the maximum events count is reached, the Epoch is closed, and writes transition to the successor Epoch
 * The Reader module reads Ingested events forward from a given Index on the Epoch's stream
 * The Checkpoint per Index consists of the pair of 1. EpochId 2. Event Index within that Epoch (see `module Checkpoint` for detail)
 */
import { AppendsEpochId, AppendsPartitionId, IndexStreamId } from "./Identifiers.js"
import { Checkpoint } from "./Checkpoint.js"
import {
  CachingStrategy,
  Codec,
  Decider,
  LoadOption,
  ITimelineEvent,
  StreamId,
  StreamName,
  ICachingStrategy,
  ICodec,
  Category,
} from "@equinox-js/core"
import { IngestResult } from "./ExactlyOnceIngester.js"
import { AccessStrategy, DynamoStoreCategory, DynamoStoreContext } from "@equinox-js/dynamo-store"
import { Map } from "immutable"
import { MemoryStoreCategory, VolatileStore } from "@equinox-js/memory-store"

export const maxItemsPerEpoch = Checkpoint.MAX_ITEMS_PER_EPOCH

export namespace Stream {
  export const category = "$AppendsEpoch"
  export const streamId = StreamId.gen(AppendsPartitionId.toString, AppendsEpochId.toString)
  export const decodeId = StreamId.dec(AppendsPartitionId.parse, AppendsEpochId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}

export namespace Events {
  export type StreamSpan = { p: IndexStreamId; i: number; c: string[] }
  export type Ingested = { add: StreamSpan[]; app: StreamSpan[] }

  export type Event =
    // Structure mapped from DynamoStore.Batch.Schema: p: stream, i: index, c: array of event types
    { type: "Ingested"; data: Ingested } | { type: "Closed" }

  export const codec = Codec.deflate(Codec.json<Event>())
  export const isEventTypeClosed = (et: string) => et === "Closed"
}

const next = (x: Events.StreamSpan) => Number(x.i) + x.c.length

/** Aggregates all spans per stream into a single Span from the lowest index to the highest */
export const flatten = (spans: Events.StreamSpan[]): Events.StreamSpan[] => {
  const grouped: Record<IndexStreamId, Events.StreamSpan[]> = {}
  for (const span of spans) {
    grouped[span.p] || (grouped[span.p] = [])
    grouped[span.p].push(span)
  }
  return Object.entries(grouped).map(([p, xs]): Events.StreamSpan => {
    let i = -1
    let c: string[] = []
    for (const x of xs) {
      if (i === -1) i = x.i
      const n = i + c.length
      const overlap = n - x.i
      if (overlap < 0) throw new Error(`Invalid gap of ${-overlap} at ${n} in '${p}'`)
      c.push(...x.c.slice(overlap))
    }
    return { p: p as IndexStreamId, i, c }
  })
}

export namespace Fold {
  export type State = { versions: Map<IndexStreamId, number>; closed: boolean }
  const withVersions = (state: State, e: Events.Ingested): State => {
    let versions = state.versions
    for (const x of e.add) {
      versions = versions.set(x.p, next(x))
    }
    for (const x of e.app) {
      versions = versions.set(x.p, next(x))
    }
    return { ...state, versions }
  }
  export const withClosed = (state: State): State => ({ ...state, closed: true })

  export const initial: State = { versions: Map(), closed: false }
  const evolve = (state: State, event: Events.Event): State => {
    switch (event.type) {
      case "Ingested":
        return withVersions(state, event.data)
      case "Closed":
        return withClosed(state)
    }
  }
  export const fold = (state: State, events: Events.Event[]): State => events.reduce(evolve, state)
}

export namespace Ingest {
  type Classified =
    | { type: "Start" | "Append"; data: Events.StreamSpan }
    | { type: "Discard" }
    | { type: "Gap"; data: number }
  const classify = ({ versions: cur }: Fold.State, eventSpan: Events.StreamSpan): Classified => {
    const curNext = cur.get(eventSpan.p)
    if (curNext == null) return { type: "Start", data: eventSpan }
    const appendLen = next(eventSpan) - curNext
    if (appendLen > eventSpan.c.length) return { type: "Gap", data: appendLen - eventSpan.c.length }
    if (appendLen > 0) {
      return {
        type: "Append",
        data: {
          p: eventSpan.p,
          i: curNext,
          c: eventSpan.c.slice(eventSpan.c.length - appendLen),
        },
      }
    }
    return { type: "Discard" }
  }

  /**
   * Takes a set of spans, flattens them and trims them relative to the currently established per-stream high-watermarks
   */
  const tryToIngested = (
    state: Fold.State,
    inputs: Events.StreamSpan[],
  ): Events.Ingested | undefined => {
    const started: Events.StreamSpan[] = []
    const appended: Events.StreamSpan[] = []
    for (const eventSpan of flatten(inputs)) {
      const x = classify(state, eventSpan)
      switch (x.type) {
        case "Start":
          started.push(x.data)
          break
        case "Append":
          appended.push(x.data)
          break
        case "Gap":
          throw new Error(`Invalid gap of ${x.data} at ${eventSpan.i} in "${eventSpan.p}"`)
        case "Discard":
          break
      }
    }
    if (started.length === 0 && appended.length === 0) return
    return { add: started, app: appended }
  }

  const removeDuplicates = (
    state: Fold.State,
    inputs: Events.StreamSpan[],
  ): Events.StreamSpan[] => {
    const result: Events.StreamSpan[] = []
    for (const eventSpan of flatten(inputs)) {
      const x = classify(state, eventSpan)
      switch (x.type) {
        case "Start":
        case "Append":
          result.push(x.data)
          break
        case "Gap":
          result.push(eventSpan)
      }
    }
    return result
  }

  export const decide = (
    shouldClose: (n: number) => boolean,
    inputs: Events.StreamSpan[],
    state: Fold.State,
  ): [IngestResult<Events.StreamSpan, IndexStreamId>, Events.Event[]] => {
    if (state.closed)
      return [{ accepted: [], closed: true, residual: removeDuplicates(state, inputs) }, []]
    const diff = tryToIngested(state, inputs)
    if (diff == null) return [{ accepted: [], closed: false, residual: [] }, []]
    let closing = shouldClose(diff.app.length + diff.add.length + state.versions.size)
    let ingestEvent: Events.Event = { type: "Ingested", data: diff }
    const events: Events.Event[] = [ingestEvent]
    if (closing) events.push({ type: "Closed" })
    let ingested = diff.add.map((x) => x.p).concat(diff.app.map((x) => x.p))
    return [{ accepted: ingested, closed: closing, residual: [] }, events]
  }
}

export class Service {
  constructor(
    private readonly shouldClose: (
      bytes: bigint | undefined,
      version: bigint,
      n: number,
    ) => boolean,
    private readonly resolve: (
      trancehId: AppendsPartitionId,
      epochId: AppendsEpochId,
    ) => Decider<Events.Event, Fold.State>,
  ) {}

  async ingest(
    trancheId: AppendsPartitionId,
    epochId: AppendsEpochId,
    spans: Events.StreamSpan[],
    assumeEmpty = false,
  ): Promise<IngestResult<Events.StreamSpan, IndexStreamId>> {
    const decider = this.resolve(trancheId, epochId)
    if (spans.length === 0) return { accepted: [], closed: false, residual: [] }
    const isSelf = (p: IndexStreamId) => p.startsWith(`${Stream.category}-`)
    if (spans.some((x) => isSelf(x.p)))
      throw new Error("Writes to indices should be filtered prior to indexing")
    return decider.transactEx(
      (c) =>
        Ingest.decide((n) => this.shouldClose(c.streamEventBytes, c.version, n), spans, c.state),
      assumeEmpty ? LoadOption.AssumeEmpty : LoadOption.AnyCachedValue,
    )
  }
}

export namespace Config {
  const createCategory = (context: DynamoStoreContext, cache?: ICachingStrategy) =>
    DynamoStoreCategory.create(
      context,
      Stream.category,
      Events.codec,
      Fold.fold,
      Fold.initial,
      cache,
      AccessStrategy.Unoptimized(),
    )

  // prettier-ignore
  function fromCategory(category: Category<Events.Event, Fold.State>, maxBytes: number, maxVersion: bigint, maxStreams: number) {
    let shouldClose = (totalBytes: bigint | undefined, version: bigint, totalStreams: number) => {
      return (totalBytes || 0n) > maxBytes || version >= maxVersion || totalStreams >= maxStreams
    }

    return new Service(shouldClose, (trancheId, epochId) =>
      Decider.forStream(category, Stream.streamId(trancheId, epochId), null),
    )
  }

  export const create = (
    maxBytes: number,
    maxVersion: bigint,
    maxStreams: number,
    context: DynamoStoreContext,
    cache?: ICachingStrategy,
  ) => {
    const category = createCategory(context, cache)
    return fromCategory(category, maxBytes, maxVersion, maxStreams)
  }

  export const createMem = (
    maxBytes: number,
    maxVersion: bigint,
    maxStreams: number,
    store: VolatileStore<any>,
  ) =>
    fromCategory(
      MemoryStoreCategory.create(store, Stream.category, Events.codec, Fold.fold, Fold.initial),
      maxBytes,
      maxVersion,
      maxStreams,
    )
}

export namespace Reader {
  type Event = [bigint, Events.Event]
  const strCodec: ICodec<Event, string, unknown> = {
    encode() {
      throw new Error("This is a read only codec")
    },
    tryDecode(event: ITimelineEvent<string>): Event | undefined {
      const data = JSON.parse(event.data ?? "null")
      return [event.index, { type: event.type, data: data } as Events.Event]
    },
  }
  const codec = Codec.deflate(strCodec)
  export type State = { changes: [number, Events.StreamSpan[]][]; closed: boolean }

  const initial: State = { changes: [], closed: false }
  const fold = (state: State, events: Event[]) => {
    let closed = state.closed
    const changes = state.changes.slice()
    for (const [i, x] of events) {
      switch (x.type) {
        case "Closed":
          closed = true
          break
        case "Ingested":
          changes.push([Number(i), x.data.add.concat(x.data.app)])
      }
    }
    return { changes, closed }
  }

  export class Service {
    constructor(
      private readonly resolve: (
        t: AppendsPartitionId,
        e: AppendsEpochId,
        v: bigint,
      ) => Decider<Event, State>,
    ) {}

    read(
      trancheId: AppendsPartitionId,
      epochId: AppendsEpochId,
      minIndex: bigint,
    ): Promise<[bigint | undefined, bigint, State]> {
      const decider = this.resolve(trancheId, epochId, minIndex)
      return decider.queryEx((c) => [c.streamEventBytes, c.version, c.state])
    }

    readVersion(trancheId: AppendsPartitionId, epochId: AppendsEpochId) {
      const decider = this.resolve(trancheId, epochId, 9223372036854775807n)
      return decider.queryEx((c) => c.version)
    }
  }

  export namespace Config {
    const createMemoryCategory = (store: VolatileStore<any>, minIndex: bigint) => {
      const trimPotentialOverstep = (ev: Event[]) => ev.filter(([i]) => i >= minIndex)
      const fold_ = (s: State, e: Event[]) => fold(s, trimPotentialOverstep(e))
      return MemoryStoreCategory.create(store, Stream.category, codec, fold_, initial)
    }
    const createCategory = (context: DynamoStoreContext, minIndex: bigint) => {
      const isOrigin = ([i, _]: [bigint, unknown]) => i <= minIndex
      const trimPotentialOverstep = (ev: Event[]) => ev.filter(([i]) => i >= minIndex)
      const fold_ = (s: State, e: Event[]) => fold(s, trimPotentialOverstep(e))
      const access = AccessStrategy.MultiSnapshot<Event, State>(isOrigin, () => {
        throw new Error("writing not applicable")
      })

      // prettier-ignore
      return DynamoStoreCategory.create(context, Stream.category, codec, fold_, initial, CachingStrategy.NoCache(), access)
    }
    export const create = (context: DynamoStoreContext) =>
      new Service((tid, eid, minIndex) =>
        Decider.forStream(createCategory(context, minIndex), Stream.streamId(tid, eid), null),
      )

    export const createMem = (store: VolatileStore<any>) =>
      new Service((tid, eid, minIndex) =>
        Decider.forStream(createMemoryCategory(store, minIndex), Stream.streamId(tid, eid), null),
      )
  }
}
