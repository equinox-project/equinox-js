import {
  AppendsEpochId,
  AppendsPartitionId,
  Checkpoint,
  IndexStreamId,
} from "@equinox-js/dynamo-store-indexer"
import { DynamoStoreContext, EventsContext } from "@equinox-js/dynamo-store"
import { AppendsIndex, AppendsEpoch } from "@equinox-js/dynamo-store-indexer"
import { EncodedBody, Codec, ITimelineEvent, StreamName } from "@equinox-js/core"
import pLimit from "p-limit"
import { ICheckpoints, StreamsSink, TailingFeedSource } from "@equinox-js/propeller"

function keepMap<T, V>(arr: T[], fn: (x: T) => V | undefined): V[] {
  const out: V[] = []
  for (const x of arr) {
    const v = fn(x)
    if (v !== undefined) out.push(v)
  }
  return out
}

type StreamEvent = [StreamName, ITimelineEvent]

type Batch = { items: StreamEvent[]; checkpoint: Checkpoint; isTail: boolean }

namespace Impl {
  export const readTailPositionForTranche = async (
    index: ReturnType<typeof AppendsIndex.Reader.create>,
    epochs: AppendsEpoch.Reader.Service,
    partitionId: AppendsPartitionId,
  ) => {
    const epochId = await index.readIngestionEpochId(partitionId)
    const version = await epochs.readVersion(partitionId, epochId)
    return Checkpoint.positionOfEpochAndOffset(epochId, version)
  }

  const mkBatch = (checkpoint: Checkpoint, isTail: boolean, items: StreamEvent[]): Batch => ({
    checkpoint,
    isTail,
    items,
  })

  const sliceBatch = (epochId: AppendsEpochId, offset: number, items: StreamEvent[]) =>
    mkBatch(Checkpoint.positionOfEpochAndOffset(epochId, BigInt(offset)), false, items)

  const finalBatch = (
    epochId: AppendsEpochId,
    version: bigint,
    state: AppendsEpoch.Reader.State,
    items: StreamEvent[],
  ) =>
    mkBatch(
      Checkpoint.positionOfEpochClosedAndVersion(epochId, state.closed, version),
      !state.closed,
      items,
    )

  type MaybeLoad = (
    streamName: StreamName,
    version: number,
    types: string[],
  ) => (() => Promise<ITimelineEvent<EncodedBody>[]>) | undefined

  function streamEventsFromState(maybeLoad: MaybeLoad, state: AppendsEpoch.Reader.State) {
    const all = AppendsEpoch.flatten(state.changes.flatMap(([_i, xs]) => xs))
    let chosenEvents = 0
    const chooseStream = (span: AppendsEpoch.Events.StreamSpan) => {
      const load = maybeLoad(span.p as any as StreamName, span.i, span.c)
      if (load) {
        chosenEvents += span.c.length
        return [span.p, load] as const
      }
    }

    return Object.fromEntries(keepMap(all, chooseStream))
  }

  // Includes optional hydrating of events with event bodies and/or metadata (controlled via hydrating/maybeLoad args)
  export async function* materializeIndexEpochAsBatchesOfStreamEvents(
    epochs: AppendsEpoch.Reader.Service,
    maybeLoad: MaybeLoad,
    loadDop: number,
    batchCutoff: number,
    partitionId: AppendsPartitionId,
    position: Checkpoint,
  ) {
    const [epochId, offset] = Checkpoint.toEpochAndOffset(position)
    const [_size, version, state] = await epochs.read(partitionId, epochId, offset)
    const streamEvents = streamEventsFromState(maybeLoad, state)
    const buffer: AppendsEpoch.Events.StreamSpan[] = []
    const cache = new Map<IndexStreamId, ITimelineEvent<EncodedBody>[]>()
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
      const result: StreamEvent[] = []
      for (const span of buffer) {
        const items = cache.get(span.p)
        if (items == undefined) continue
        // NOTE this could throw if a span has been indexed, but the stream read is from a replica that does not yet have it
        //      the exception in that case will trigger a safe re-read from the last saved read position that a consumer has forwarded
        // TOCONSIDER revise logic to share session key etc to rule this out
        const sliceFrom = span.i - Number(items[0].index)
        const events = items.slice(sliceFrom, sliceFrom + span.c.length)
        for (const event of events) result.push([StreamName.parse(span.p), inflate(event)])
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

type ReadEvents = (
  sn: StreamName,
  i: number,
  count: number,
) => Promise<ITimelineEvent<EncodedBody>[]>
export type LoadMode =
  | { type: "IndexOnly" }
  | {
      type: "WithData"
      degreeOfParallelism: number
      /** Defines the function to use when loading the Event Data/Meta */
      read: ReadEvents
    }

export namespace LoadMode {
  /** Skip loading of Data/Meta for events; this is the most efficient mode as it means the Source only needs to read from the index */
  export const IndexOnly = (): LoadMode => ({ type: "IndexOnly" })

  export const WithDataEx = (degreeOfParallelism: number, read: ReadEvents): LoadMode => ({
    type: "WithData",
    degreeOfParallelism,
    read,
  })
  /** Populates the Data/Meta fields for events; necessitates loads of all individual streams that pass the categoryFilter before they can be handled */
  export const WithData = (degreeOfParallelism: number, context: DynamoStoreContext): LoadMode => {
    const eventContext = new EventsContext(context)
    const read: ReadEvents = (sn, i, count) => eventContext.read(sn, i, undefined, count, undefined)
    return WithDataEx(degreeOfParallelism, read)
  }

  const withBodies =
    (read: ReadEvents, streamFilter: (sn: StreamName) => boolean) =>
    (sn: StreamName, i: number, c: string[]) => {
      if (streamFilter(sn)) {
        return () => read(sn, i, c.length)
      }
    }
  const withoutBodies =
    (streamFilter: (sn: StreamName) => boolean) => (sn: StreamName, i: number, c: string[]) => {
      const renderEvent = (c: string, offset: number): ITimelineEvent<EncodedBody> => ({
        type: c,
        index: BigInt(i + offset),
        id: "",
        isUnfold: false,
        size: 0,
        time: new Date(),
      })
      if (streamFilter(sn)) {
        return async () => c.map(renderEvent)
      }
    }

  export const map = (streamFilter: (c: StreamName) => boolean, loadMode: LoadMode) => {
    switch (loadMode.type) {
      case "IndexOnly":
        return {
          hydrating: false,
          tryLoad: withoutBodies(streamFilter),
          degreeOfParallelism: 1,
        }
      case "WithData":
        return {
          hydrating: true,
          tryLoad: withBodies(loadMode.read, streamFilter),
          degreeOfParallelism: loadMode.degreeOfParallelism,
        }
    }
  }
}

export class DynamoStoreSourceClient {
  dop: number
  hydrating: boolean
  tryLoad: (
    sn: StreamName,
    i: number,
    c: string[],
  ) => (() => Promise<ITimelineEvent<EncodedBody>[]>) | undefined

  constructor(
    private readonly epochs: AppendsEpoch.Reader.Service,
    private readonly index: AppendsIndex.Reader,
    streamFilter: (sn: StreamName) => boolean,
    loadMode: LoadMode,
    private readonly partitionIds?: AppendsPartitionId[],
  ) {
    const lm = LoadMode.map(streamFilter, loadMode)
    this.dop = lm.degreeOfParallelism
    this.hydrating = lm.hydrating
    this.tryLoad = lm.tryLoad
  }

  crawl(partitionId: AppendsPartitionId, position: Checkpoint): AsyncIterable<Batch> {
    return Impl.materializeIndexEpochAsBatchesOfStreamEvents(
      this.epochs,
      this.tryLoad,
      this.dop,
      100,
      partitionId,
      position,
    )
  }

  async listPartitions(): Promise<AppendsPartitionId[]> {
    if (this.partitionIds) return this.partitionIds
    const res = await this.index.readKnownPartitions()
    return res.length === 0 ? [AppendsPartitionId.wellKnownId] : res
  }
}

interface CreateOptions {
  /** The database pool to use to read messages from the category */
  context: DynamoStoreContext
  batchSizeCutoff: number
  /** sleep time in ms between reads when at the end of the category */
  tailSleepIntervalMs: number
  /** The checkpointer to use for checkpointing */
  checkpoints: ICheckpoints
  mode: LoadMode
  /** The categories to read from */
  categories?: string[]
  streamFilter?: (streamName: StreamName) => boolean
  startFromTail?: boolean
  readFailureSleepIntervalMs?: number

  /** The name of the consumer group to use for checkpointing */
  groupName: string
  /** The handler to call for each batch of stream messages */
  handler: (streamName: StreamName, events: ITimelineEvent[]) => Promise<void>
  /** The maximum number of concurrent streams to process, enforced via p-limit */
  maxConcurrentStreams: number
}

function inflate(event: ITimelineEvent<EncodedBody>): ITimelineEvent {
  let decodedData: string | undefined
  let decodedMeta: string | undefined
  return {
    index: event.index,
    id: event.id,
    type: event.type,
    time: event.time,
    size: event.size,
    isUnfold: event.isUnfold,
    get data() {
      if (!event.data?.body?.length) return undefined
      if (!decodedData) decodedData = Codec.smartDecompress(event.data)?.toString()
      return decodedData
    },
    get meta() {
      if (!event.meta?.body?.length) return undefined
      if (!decodedMeta) decodedMeta = Codec.smartDecompress(event.meta)?.toString()
      return decodedMeta
    },
  }
}

const categoryFilter = (categories: string[]) => {
  const prefixes = categories.map((x) => x + "-")
  return (sn: StreamName) => {
    for (let i = 0; i < prefixes.length; ++i) {
      if (sn.startsWith(prefixes[i])) return true
    }
    return false
  }
}

export class DynamoStoreSource {
  private inner: TailingFeedSource
  private client: DynamoStoreSourceClient

  constructor(
    private readonly index: AppendsIndex.Reader,
    private epochs: AppendsEpoch.Reader.Service,
    private readonly options: Omit<CreateOptions, "context">,
  ) {
    if (!this.options.categories && !this.options.streamFilter) {
      throw new Error("Either categories or categoryFilter must be specified")
    }
    const sink = new StreamsSink(this.options.handler, this.options.maxConcurrentStreams)
    const streamFilter = options.streamFilter ?? categoryFilter(options.categories!)
    this.client = new DynamoStoreSourceClient(epochs, index, streamFilter, options.mode)
    const crawl = (tranche: string, position: bigint, _signal: AbortSignal) =>
      this.client.crawl(AppendsPartitionId.parse(tranche), Checkpoint.ofPosition(position))
    this.inner = new TailingFeedSource(
      "DynamoStore",
      options.tailSleepIntervalMs,
      options.groupName,
      options.checkpoints,
      sink,
      crawl,
      options.startFromTail
        ? (tranche: string) =>
            Impl.readTailPositionForTranche(index, epochs, AppendsPartitionId.parse(tranche))
        : undefined,
    )
  }

  async start(signal: AbortSignal) {
    const partitions = await this.client.listPartitions()
    await Promise.all(
      partitions.map((partition) =>
        this.inner.start(AppendsPartitionId.toString(partition), signal),
      ),
    )
  }

  static create(options: CreateOptions): DynamoStoreSource {
    const index = AppendsIndex.Reader.create(options.context)
    const epochs = AppendsEpoch.Reader.Config.create(options.context)
    return new DynamoStoreSource(index, epochs, options)
  }
}
