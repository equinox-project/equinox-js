import { AppendsEpochId, AppendsTrancheId, Checkpoint, IndexStreamId } from "./Types.js"
import { DynamoStoreClient, DynamoStoreContext, EncodedBody, EventsContext } from "@equinox-js/dynamo-store"
import * as AppendsIndex from "./AppendsIndex.js"
import { keepMap } from "./Array.js"
import * as AppendsEpoch from "./AppendsEpoch.js"
import { ITimelineEvent } from "@equinox-js/core"
import pLimit from "p-limit"
import { StreamName } from "@equinox-js/stream-name"

type EventBody = Uint8Array
type StreamEvent<Format> = [string, ITimelineEvent<Format>]

type Batch<Event> = { items: StreamEvent<Event>[]; checkpoint: Checkpoint.t; isTail: boolean }

namespace Impl {
  const renderPos = (pos: Checkpoint.t) => {
    const [epoch, offset] = Checkpoint.toEpochAndOffset(pos)
    return `${epoch}@${offset}`
  }

  export const readTranches = (context: DynamoStoreContext) => {
    const index = AppendsIndex.Reader.create(context)
    return index.readKnownTranches()
  }

  const readTailPositionForTranche = async (context: DynamoStoreContext, trancheId: AppendsTrancheId.t) => {
    const index = AppendsIndex.Reader.create(context)
    const epochId = await index.readIngestionEpochId(trancheId)
    const epochs = AppendsEpoch.Reader.Config.create(context)
    const version = await epochs.readVersion(trancheId, epochId)
    return Checkpoint.positionOfEpochAndOffset(epochId, version)
  }

  const mkBatch = (checkpoint: Checkpoint.t, isTail: boolean, items: StreamEvent<EncodedBody>[]): Batch<EncodedBody> => ({
    checkpoint,
    isTail,
    items,
  })

  const sliceBatch = (epochId: AppendsEpochId.t, offset: number, items: StreamEvent<EncodedBody>[]) =>
    mkBatch(Checkpoint.positionOfEpochAndOffset(epochId, BigInt(offset)), false, items)

  const finalBatch = (epochId: AppendsEpochId.t, version: bigint, state: AppendsEpoch.Reader.State, items: StreamEvent<EncodedBody>[]) =>
    mkBatch(Checkpoint.positionOfEpochClosedAndVersion(epochId, state.closed, version), !state.closed, items)

  // Includes optional hydrating of events with event bodies and/or metadata (controlled via hydrating/maybeLoad args)
  export async function* materializeIndexEpochAsBatchesOfStreamEvents(
    context: DynamoStoreContext,
    hydrating: boolean,
    maybeLoad: (streamName: string, version: number, types: string[]) => (() => Promise<ITimelineEvent<EncodedBody>[]>) | undefined,
    loadDop: number,
    batchCutoff: number,
    tid: AppendsTrancheId.t,
    position: Checkpoint.t
  ) {
    const epochs = AppendsEpoch.Reader.Config.create(context)
    const [epochId, offset] = Checkpoint.toEpochAndOffset(position)
    const [_size, version, state] = await epochs.read(tid, epochId, offset)
    const totalChanges = state.changes.length
    const [totalStreams, chosenEvents, totalEvents, streamEvents] = (() => {
      const all = AppendsEpoch.flatten(state.changes.flatMap(([_i, xs]) => xs))
      const totalEvents = all.reduce((p, v) => p + v.c.length, 0)
      let chosenEvents = 0
      const chooseStream = (span: AppendsEpoch.Events.StreamSpan) => {
        const load = maybeLoad(span.p, span.i, span.c)
        if (load) {
          chosenEvents += span.c.length
          return [span.p, load] as const
        }
      }

      const streamEvents = Object.fromEntries(keepMap(all, chooseStream))
      return [all.length, chosenEvents, totalEvents, streamEvents] as const
    })()
    const buffer: AppendsEpoch.Events.StreamSpan[] = []
    const cache = new Map<IndexStreamId.t, ITimelineEvent<EncodedBody>[]>()
    const materializeSpans = async () => {
      const streamsToLoad = new Set(keepMap(buffer, (span) => (!cache.has(span.p) ? span.p : undefined)))
      const loadsRequired = Array.from(streamsToLoad).map((p) => async () => {
        const items = await streamEvents[p]()
        cache.set(p, items)
      })

      if (loadsRequired.length > 0) {
        const limit = pLimit(loadDop)
        await Promise.all(loadsRequired.map((f) => limit(f)))
      }
      const result: StreamEvent<EncodedBody>[] = []
      for (const span of buffer) {
        const items = cache.get(span.p)
        if (items == undefined) continue
        // NOTE this could throw if a span has been indexed, but the stream read is from a replica that does not yet have it
        //      the exception in that case will trigger a safe re-read from the last saved read position that a consumer has forwarded
        // TOCONSIDER revise logic to share session key etc to rule this out
        const sliceFrom = span.i - Number(items[0].index)
        const events = items.slice(sliceFrom, sliceFrom + span.c.length)
        for (const event of events) result.push([span.p, event])
      }
      return result
    }

    for (const [i, spans] of state.changes) {
      const pending = spans.filter((span) => streamEvents[span.p] != null)
      if (buffer.length > 0 && buffer.length + pending.length > batchCutoff) {
        const hydrated = await materializeSpans()
        yield sliceBatch(epochId, i, hydrated)
        buffer.length = 0 // Evil mutation that clears an array
      }
      buffer.push(...pending)
    }
    const hydrated = await materializeSpans()
    yield finalBatch(epochId, version, state, hydrated)
  }
}

export type LoadMode =
  /** Skip loading of Data/Meta for events; this is the most efficient mode as it means the Source only needs to read from the index */
  | { type: "WithoutEventBodies"; categoryFilter: (cat: string) => boolean }
  /** Populates the Data/Meta fields for events; necessitates loads of all individual streams that pass the categoryFilter before they can be handled */
  | {
      type: "Hydrated"
      categoryFilter: (cat: string) => boolean
      degreeOfParallelism: number
      /** Defines the Context to use when loading the Event Data/Meta */
      context: DynamoStoreContext
    }

namespace LoadMode {
  const withBodies = (eventsContext: EventsContext, categoryFilter: (cat: string) => boolean) => (sn: string, i: bigint, c: string[]) => {
    const streamName = StreamName.parse(sn)
    if (categoryFilter(streamName.category)) {
      return async () => {
        const [_pos, events] = await eventsContext.read(sn, i, undefined, c.length, undefined)
        return events
      }
    }
  }
  const withoutBodies = (categoryFilter: (cat: string) => boolean) => (sn: string, i: number, c: string[]) => {
    const streamName = StreamName.parse(sn)
    const renderEvent = (c: string, offset: number): ITimelineEvent<EventBody> => {
      return {
        type: c,
        index: BigInt(i + offset),
        id: "",
        isUnfold: false,
        size: 0,
        time: new Date(),
      }
    }
    if (categoryFilter(streamName.category)) {
      return async () => c.map(renderEvent)
    }
  }

  export const map = (loadMode: LoadMode) => {
    switch (loadMode.type) {
      case "WithoutEventBodies":
        return { hydrating: false, tryLoad: withoutBodies(loadMode.categoryFilter), degreeOfParallelism: 1 }
      case "Hydrated":
        return {
          hydrating: true,
          tryLoad: withBodies(new EventsContext(loadMode.context), loadMode.categoryFilter),
          degreeOfParallelism: loadMode.degreeOfParallelism,
        }
    }
  }
}

export class DynamoStoreSourceClient {
  dop: number
  hydrating: boolean
  tryLoad: any
  constructor(private readonly indexClient: DynamoStoreClient, loadMode: LoadMode, private readonly trancheIds?: AppendsTrancheId.t[]) {
    const lm = LoadMode.map(loadMode)
    this.dop = lm.degreeOfParallelism
    this.hydrating = lm.hydrating
    this.tryLoad = lm.tryLoad
  }

  crawl(trancheId: AppendsTrancheId.t, position: Checkpoint.t): AsyncIterable<Batch<EncodedBody>> {
    return Impl.materializeIndexEpochAsBatchesOfStreamEvents(
      new DynamoStoreContext(this.indexClient),
      this.hydrating,
      this.tryLoad,
      this.dop,
      100,
      trancheId,
      position
    )
  }

  async listTranches() {
    if (this.trancheIds) return this.trancheIds
    const ctx = new DynamoStoreContext(this.indexClient)
    const res = await Impl.readTranches(ctx)
    return res.length === 0 ? [AppendsTrancheId.wellKnownId] : res
  }
}
