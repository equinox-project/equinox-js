/**
 * Maintains a sequence of Ingested StreamSpans representing groups of stream writes that were indexed at the same time
 * Ingestion takes care of deduplicating each batch of writes with reference to the existing spans recorded for this Epoch (only)
 * When the maximum events count is reached, the Epoch is closed, and writes transition to the successor Epoch
 * The Reader module reads Ingested events forward from a given Index on the Epoch's stream
 * The Checkpoint per Index consists of the pair of 1. EpochId 2. Event Index within that Epoch (see `module Checkpoint` for detail)
 */
import { AppendsEpochId, AppendsTrancheId, Checkpoint, IndexStreamId } from "./Types"
import { AsyncCodec, Codec, Decider, TimelineEvent } from "@equinox-js/core"
import { IngestResult } from "./ExactlyOnceIngester"
import { AccessStrategy, CachingStrategy, DynamoStoreCategory, DynamoStoreContext } from "@equinox-js/dynamo-store"

export const maxItemsPerEpoch = Checkpoint.MAX_ITEMS_PER_EPOCH
export const Category = "$AppendsEpoch"
const streamId = (tranche: AppendsTrancheId.t, epoch: AppendsEpochId.t) => `${AppendsTrancheId.toString(tranche)}_${AppendsEpochId.toString(epoch)}`

export const parseStreamName = (streamName: string): [AppendsTrancheId.t, AppendsEpochId.t] | undefined => {
  const idx = streamName.indexOf("-")
  const cat = streamName.slice(0, idx)
  if (cat !== Category) return
  const ids = streamName.slice(idx + 1).split("_")
  if (ids.length === 2) return [AppendsTrancheId.parse(ids[0]), AppendsEpochId.parse(ids[1])]
}

export namespace Events {
  export type StreamSpan = { p: IndexStreamId.t; i: number; c: string[] }
  export type Ingested = { add: StreamSpan[]; app: StreamSpan[] }

  export type Event =
    // Structure mapped from DynamoStore.Batch.Schema: p: stream, i: index, c: array of event types
    { type: "Ingested"; data: Ingested } | { type: "Closed" }

  export const codec = AsyncCodec.unsafeEmpty<Event>()
  export const isEventTypeClosed = (et: string) => et === "Closed"
}

const next = (x: Events.StreamSpan) => Number(x.i) + x.c.length
const flatten = (spans: Events.StreamSpan[]): Events.StreamSpan[] => {
  const grouped: Record<IndexStreamId.t, Events.StreamSpan[]> = {}
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
    return { p: p as IndexStreamId.t, i, c }
  })
}

namespace Fold {
  export type State = { versions: Record<IndexStreamId.t, number>; closed: boolean }
  const withVersions = (state: State, e: Events.Ingested): State => {
    const versions = Object.assign({}, state.versions)
    for (const x of e.add) {
      versions[x.p] = next(x)
    }
    for (const x of e.app) {
      versions[x.p] = next(x)
    }
    return { ...state, versions }
  }
  const withClosed = (state: State): State => ({ ...state, closed: true })

  export const initial: State = { versions: {}, closed: false }
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

namespace Ingest {
  const classify = (
    { versions: cur }: Fold.State,
    eventSpan: Events.StreamSpan
  ): { type: "Start" | "Append"; data: Events.StreamSpan } | { type: "Discard" } => {
    const curNext = cur[eventSpan.p]
    if (curNext == null) return { type: "Start", data: eventSpan }
    const appendLen = next(eventSpan) - curNext
    if (appendLen > 0) {
      return { type: "Append", data: { p: eventSpan.p, i: curNext, c: eventSpan.c.slice(eventSpan.c.length - appendLen) } }
    }
    return { type: "Discard" }
  }

  /**
   * Takes a set of spans, flattens them and trims them relative to the currently established per-stream high-watermarks
   */
  const tryToIngested = (state: Fold.State, inputs: Events.StreamSpan[]): Events.Ingested | undefined => {
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
        case "Discard":
          break
      }
    }
    if (started.length === 0 && appended.length === 0) return
    return { add: started, app: appended }
  }

  const removeDuplicates = (state: Fold.State, inputs: Events.StreamSpan[]): Events.StreamSpan[] => {
    const result: Events.StreamSpan[] = []
    for (const eventSpan of flatten(inputs)) {
      const x = classify(state, eventSpan)
      switch (x.type) {
        case "Start":
        case "Append":
          result.push(x.data)
      }
    }
    return result
  }

  export const decide = (
    shouldClose: (n: number) => boolean,
    inputs: Events.StreamSpan[],
    state: Fold.State
  ): [IngestResult<Events.StreamSpan, IndexStreamId.t>, Events.Event[]] => {
    if (state.closed) return [{ accepted: [], closed: true, residual: removeDuplicates(state, inputs) }, []]
    const diff = tryToIngested(state, inputs)
    if (diff == null) return [{ accepted: [], closed: false, residual: [] }, []]
    let closing = shouldClose(diff.app.length + diff.add.length + Object.keys(state.versions).length)
    let ingestEvent: Events.Event = { type: "Ingested", data: diff }
    const events: Events.Event[] = [ingestEvent]
    if (closing) events.push({ type: "Closed" })
    let ingested = diff.add.map((x) => x.p).concat(diff.app.map((x) => x.p))
    return [{ accepted: ingested, closed: closing, residual: [] }, events]
  }
}

export class Service {
  constructor(
    private readonly shouldClose: (bytes: bigint | undefined, version: bigint, n: number) => boolean,
    private readonly resolve: (trancehId: AppendsTrancheId.t, epochId: AppendsEpochId.t) => Decider<Events.Event, Fold.State>
  ) {}

  async ingest(
    trancheId: AppendsTrancheId.t,
    epochId: AppendsEpochId.t,
    spans: Events.StreamSpan[],
    assumeEmpty = false
  ): Promise<IngestResult<Events.StreamSpan, IndexStreamId.t>> {
    const decider = this.resolve(trancheId, epochId)
    if (spans.length === 0) return { accepted: [], closed: false, residual: [] }
    const isSelf = (p: IndexStreamId.t) => p.startsWith(`${Category}-`)
    if (spans.some((x) => isSelf(x.p))) throw new Error("Writes to indices should be filtered prior to indexing")
    return decider.transactEx(
      (c) => Ingest.decide((n) => this.shouldClose(c.streamEventBytes, c.version, n), spans, c.state),
      assumeEmpty ? "AssumeEmpty" : "AllowStale"
    )
  }
}

export namespace Config {
  const createCategory = (context: DynamoStoreContext, cache: CachingStrategy.CachingStrategy) =>
    DynamoStoreCategory.build(context, Events.codec, Fold.fold, Fold.initial, cache, AccessStrategy.Unoptimized())

  export const create = (
    maxBytes: number,
    maxVersion: bigint,
    maxStreams: number,
    context: DynamoStoreContext,
    cache: CachingStrategy.CachingStrategy
  ) => {
    const category = createCategory(context, cache)
    let shouldClose = (totalBytes: bigint | undefined, version: bigint, totalStreams: number) => {
      return (totalBytes || 0n) > maxBytes || version >= maxVersion || totalStreams >= maxStreams
    }

    return new Service(shouldClose, (trancheId, epochId) => Decider.resolve(category, Category, streamId(trancheId, epochId), null))
  }
}

export namespace Reader {
  type Event = [bigint, Events.Event]
  const codec: Codec<Event, unknown> = {
    encode() {
      throw new Error("This is a read only codec")
    },
    tryDecode(event: TimelineEvent<Record<string, any>>): Event | undefined {
      return [event.index, { type: event.type, data: event.data } as Events.Event]
    },
  }
  const asyncCodec = AsyncCodec.deflate(codec)
  type State = { changes: [number, Events.StreamSpan[]][]; closed: boolean }

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
    constructor(private readonly resolve: (t: AppendsTrancheId.t, e: AppendsEpochId.t, v: bigint) => Decider<Event, State>) {}

    read(trancheId: AppendsTrancheId.t, epochId: AppendsEpochId.t, minIndex: bigint): Promise<[bigint | undefined, bigint, State]> {
      const decider = this.resolve(trancheId, epochId, minIndex)
      return decider.queryEx((c) => [c.streamEventBytes, c.version, c.state])
    }

    readVersion(trancheId: AppendsTrancheId.t, epochId: AppendsEpochId.t) {
      const decider = this.resolve(trancheId, epochId, 9223372036854775807n)
      return decider.queryEx((c) => c.version)
    }
  }

  export namespace Config {
    const createCategory = (context: DynamoStoreContext, minIndex: bigint) => {
      const isOrigin = ([i, _]: [bigint, unknown]) => i <= minIndex
      const trimPotentialOverstep = (ev: Event[]) => ev.filter(([i]) => i >= minIndex)
      const accessStrategy = AccessStrategy.MultiSnapshot<Event, State>(isOrigin, () => {
        throw new Error("writing not applicable")
      })

      return DynamoStoreCategory.build(
        context,
        asyncCodec,
        (s, e) => fold(s, trimPotentialOverstep(e)),
        initial,
        { type: "NoCaching" },
        accessStrategy
      )
    }
    export const create = (context: DynamoStoreContext) =>
      new Service((tid, eid, minIndex) => Decider.resolve(createCategory(context, minIndex), Category, streamId(tid, eid), null))
  }
}
