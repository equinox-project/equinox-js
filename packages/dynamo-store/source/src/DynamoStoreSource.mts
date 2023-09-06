import {
  AppendsEpochId,
  AppendsTrancheId,
  Checkpoint,
  IndexStreamId,
} from "@equinox-js/dynamo-store-indexer"
import { DynamoStoreContext, EventsContext } from "@equinox-js/dynamo-store"
import { AppendsIndex, AppendsEpoch } from "@equinox-js/dynamo-store-indexer"
import { ITimelineEvent, StreamName } from "@equinox-js/core"
import pLimit, { LimitFunction } from "p-limit"
import { sleep } from "./Sleep.js"
import zlib from "zlib"
import type { ICheckpointer } from "./Checkpoints.js"

function keepMap<T, V>(arr: T[], fn: (x: T) => V | undefined): V[] {
  const out: V[] = []
  for (const x of arr) {
    const v = fn(x)
    if (v !== undefined) out.push(v)
  }
  return out
}

type EventBody = Buffer
type StreamEvent<Format> = [StreamName, ITimelineEvent<Format>]

type Batch<Event> = { items: StreamEvent<Event>[]; checkpoint: Checkpoint; isTail: boolean }

namespace Impl {
  const renderPos = (pos: Checkpoint) => {
    const [epoch, offset] = Checkpoint.toEpochAndOffset(pos)
    return `${epoch}@${offset}`
  }

  export const readTranches = (context: DynamoStoreContext) => {
    const index = AppendsIndex.Reader.create(context)
    return index.readKnownTranches()
  }

  export const readTailPositionForTranche = async (
    context: DynamoStoreContext,
    trancheId: AppendsTrancheId,
  ) => {
    const index = AppendsIndex.Reader.create(context)
    const epochId = await index.readIngestionEpochId(trancheId)
    const epochs = AppendsEpoch.Reader.Config.create(context)
    const version = await epochs.readVersion(trancheId, epochId)
    return Checkpoint.positionOfEpochAndOffset(epochId, version)
  }

  const mkBatch = (
    checkpoint: Checkpoint,
    isTail: boolean,
    items: StreamEvent<Buffer>[],
  ): Batch<Buffer> => ({
    checkpoint,
    isTail,
    items,
  })

  const sliceBatch = (epochId: AppendsEpochId, offset: number, items: StreamEvent<Buffer>[]) =>
    mkBatch(Checkpoint.positionOfEpochAndOffset(epochId, BigInt(offset)), false, items)

  const finalBatch = (
    epochId: AppendsEpochId,
    version: bigint,
    state: AppendsEpoch.Reader.State,
    items: StreamEvent<Buffer>[],
  ) =>
    mkBatch(
      Checkpoint.positionOfEpochClosedAndVersion(epochId, state.closed, version),
      !state.closed,
      items,
    )

  // Includes optional hydrating of events with event bodies and/or metadata (controlled via hydrating/maybeLoad args)
  export async function* materializeIndexEpochAsBatchesOfStreamEvents(
    context: DynamoStoreContext,
    hydrating: boolean,
    maybeLoad: (
      streamName: string,
      version: number,
      types: string[],
    ) => (() => Promise<ITimelineEvent<Buffer>[]>) | undefined,
    loadDop: number,
    batchCutoff: number,
    tid: AppendsTrancheId,
    position: Checkpoint,
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
    const cache = new Map<IndexStreamId, ITimelineEvent<Buffer>[]>()
    const materializeSpans = async () => {
      const streamsToLoad = new Set(
        keepMap(buffer, (span) => (!cache.has(span.p) ? span.p : undefined)),
      )
      const loadsRequired = Array.from(streamsToLoad).map((p) => async () => {
        const items = await streamEvents[p]()
        cache.set(p, items)
      })

      if (loadsRequired.length > 0) {
        const limit = pLimit(loadDop)
        await Promise.all(loadsRequired.map(limit))
      }
      const result: StreamEvent<Buffer>[] = []
      for (const span of buffer) {
        const items = cache.get(span.p)
        if (items == undefined) continue
        // NOTE this could throw if a span has been indexed, but the stream read is from a replica that does not yet have it
        //      the exception in that case will trigger a safe re-read from the last saved read position that a consumer has forwarded
        // TOCONSIDER revise logic to share session key etc to rule this out
        const sliceFrom = span.i - Number(items[0].index)
        const events = items.slice(sliceFrom, sliceFrom + span.c.length)
        for (const event of events) result.push([StreamName.parse(span.p), event])
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
  | { type: "IndexOnly" }
  /** Populates the Data/Meta fields for events; necessitates loads of all individual streams that pass the categoryFilter before they can be handled */
  | {
      type: "WithData"
      degreeOfParallelism: number
      /** Defines the Context to use when loading the Event Data/Meta */
      context: DynamoStoreContext
    }

export namespace LoadMode {
  export const IndexOnly = (): LoadMode => ({ type: "IndexOnly" })
  export const WithData = (degreeOfParallelism: number, context: DynamoStoreContext): LoadMode => ({
    type: "WithData",
    degreeOfParallelism,
    context,
  })

  const withBodies =
    (eventsContext: EventsContext, categoryFilter: (cat: string) => boolean) =>
    (sn: StreamName, i: number, c: string[]) => {
      const category = StreamName.category(sn)
      if (categoryFilter(category)) {
        return async () => eventsContext.read(sn, i, undefined, c.length, undefined)
      }
    }
  const withoutBodies =
    (categoryFilter: (cat: string) => boolean) => (sn: StreamName, i: number, c: string[]) => {
      const renderEvent = (c: string, offset: number): ITimelineEvent<EventBody> => ({
        type: c,
        index: BigInt(i + offset),
        id: "",
        isUnfold: false,
        size: 0,
        time: new Date(),
      })
      if (categoryFilter(StreamName.category(sn))) {
        return async () => c.map(renderEvent)
      }
    }

  export const map = (categoryFilter: (c: string) => boolean, loadMode: LoadMode) => {
    switch (loadMode.type) {
      case "IndexOnly":
        return {
          hydrating: false,
          tryLoad: withoutBodies(categoryFilter),
          degreeOfParallelism: 1,
        }
      case "WithData":
        return {
          hydrating: true,
          tryLoad: withBodies(new EventsContext(loadMode.context), categoryFilter),
          degreeOfParallelism: loadMode.degreeOfParallelism,
        }
    }
  }
}

export class DynamoStoreSourceClient {
  dop: number
  hydrating: boolean
  tryLoad: any
  constructor(
    private readonly indexStoreContext: DynamoStoreContext,
    categoryFilter: (cat: string) => boolean,
    loadMode: LoadMode,
    private readonly trancheIds?: AppendsTrancheId[],
  ) {
    const lm = LoadMode.map(categoryFilter, loadMode)
    this.dop = lm.degreeOfParallelism
    this.hydrating = lm.hydrating
    this.tryLoad = lm.tryLoad
  }

  crawl(trancheId: AppendsTrancheId, position: Checkpoint): AsyncIterable<Batch<Buffer>> {
    return Impl.materializeIndexEpochAsBatchesOfStreamEvents(
      this.indexStoreContext,
      this.hydrating,
      this.tryLoad,
      this.dop,
      100,
      trancheId,
      position,
    )
  }

  async listTranches() {
    if (this.trancheIds) return this.trancheIds
    const res = await Impl.readTranches(this.indexStoreContext)
    return res.length === 0 ? [AppendsTrancheId.wellKnownId] : res
  }
}

interface CreateOptions {
  /** The database pool to use to read messages from the category */
  context: DynamoStoreContext
  batchSizeCutoff: number
  /** sleep time in ms between reads when at the end of the category */
  tailSleepIntervalMs: number
  /** The checkpointer to use for checkpointing */
  checkpoints: ICheckpointer
  mode: LoadMode
  /** The categories to read from */
  categories?: string[]
  categoryFilter?: (category: string) => boolean
  startFromTail?: boolean
  readFailureSleepIntervalMs?: number

  /** The name of the consumer group to use for checkpointing */
  groupName: string
  /** The handler to call for each batch of stream messages */
  handler: (streamName: StreamName, events: ITimelineEvent[]) => Promise<void>
  /** The maximum number of concurrent streams to process, enforced via p-limit */
  maxConcurrentStreams: number
}

function inflate(event: ITimelineEvent<Buffer>): ITimelineEvent {
  const e = event as any as ITimelineEvent
  if (event.data && event.data.length) e.data = zlib.inflateSync(event.data).toString("utf-8")
  if (event.meta && event.meta.length) e.meta = zlib.inflateSync(event.meta).toString("utf-8")
  return e
}

export class DynamoStoreSource {
  limiter: LimitFunction
  constructor(private readonly options: CreateOptions) {
    this.limiter = pLimit(options.maxConcurrentStreams)
  }

  async handleTranche(
    client: DynamoStoreSourceClient,
    tranche: AppendsTrancheId,
    signal: AbortSignal,
  ) {
    let pos = Checkpoint.ofPosition(
      await this.options.checkpoints.load(
        this.options.groupName,
        AppendsTrancheId.toString(tranche),
      ),
    )
    if (pos === Checkpoint.initial && this.options.startFromTail) {
      pos = await Impl.readTailPositionForTranche(this.options.context, tranche)
    }
    while (!signal.aborted) {
      for await (const batch of client.crawl(tranche, pos)) {
        const streams = new Map<StreamName, ITimelineEvent[]>()
        for (const [stream, event] of batch.items) {
          const events = streams.get(stream)
          if (events) {
            events.push(inflate(event))
          } else {
            streams.set(stream, [inflate(event)])
          }
        }

        const promises = []
        for (const [stream, events] of streams) {
          promises.push(this.limiter(() => this.options.handler(stream, events)))
        }

        await Promise.all(promises)
        if (batch.checkpoint !== pos) {
          await this.options.checkpoints.commit(
            this.options.groupName,
            AppendsTrancheId.toString(tranche),
            batch.checkpoint,
          )
          pos = batch.checkpoint
        }
        if (batch.isTail) await sleep(this.options.tailSleepIntervalMs, signal).catch(() => {})
      }
    }
  }

  async start(signal: AbortSignal) {
    if (!this.options.categories && !this.options.categoryFilter) {
      throw new Error("Either categories or categoryFilter must be specified")
    }
    const categoryFilter =
      this.options.categoryFilter ?? ((c) => this.options.categories!.includes(c))
    const client = new DynamoStoreSourceClient(
      this.options.context,
      categoryFilter,
      this.options.mode,
    )
    const tranches = await client.listTranches()
    await Promise.all(tranches.map((tranche) => this.handleTranche(client, tranche, signal)))
  }

  static create(options: CreateOptions): DynamoStoreSource {
    return new DynamoStoreSource(options)
  }
}
