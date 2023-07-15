import { ITimelineEvent } from "@equinox-js/core"
import { Format, MessageDbReader } from "./MessageDbClient.js"
import { context, SpanKind, trace } from "@opentelemetry/api"

type StreamEventsSlice = {
  messages: ITimelineEvent<Format>[]
  isEnd: boolean
  lastVersion: bigint
}

const toSlice = (events: ITimelineEvent<Format>[], isLast: boolean): StreamEventsSlice => {
  const lastVersion = events.length === 0 ? -1n : events[events.length - 1].index
  return { messages: events, isEnd: isLast, lastVersion }
}

const readSliceAsync = async (
  reader: MessageDbReader,
  streamName: string,
  batchSize: number,
  startPos: bigint,
  requiresLeader: boolean
) => {
  const page = await reader.readStream(streamName, startPos, batchSize, requiresLeader)
  const isLast = page.length < batchSize
  return toSlice(page, isLast)
}

const readLastEventAsync = async (
  reader: MessageDbReader,
  streamName: string,
  requiresLeader: boolean,
  eventType?: string
): Promise<StreamEventsSlice> => {
  const events = await reader.readLastEvent(streamName, requiresLeader, eventType)
  return toSlice(events == null ? [] : [events], false)
}

function readBatches(
  readSlice: (start: bigint) => Promise<StreamEventsSlice>,
  maxPermittedReads: number | undefined,
  startPosition: bigint
) {
  async function* loop(
    batchCount: number,
    pos: bigint
  ): AsyncIterable<[bigint, ITimelineEvent<any>[]]> {
    if (maxPermittedReads && batchCount >= maxPermittedReads)
      throw new Error("Batch limit exceeded")
    const slice = await readSlice(pos)
    yield [slice.lastVersion, slice.messages]
    if (!slice.isEnd) {
      yield* loop(batchCount + 1, slice.lastVersion + 1n)
    }
  }
  return loop(0, startPosition)
}

export function loadForwardsFrom(
  reader: MessageDbReader,
  batchSize: number,
  maxPermittedBatchReads: number | undefined,
  streamName: string,
  startPosition: bigint,
  requiresLeader: boolean
) {
  const span = trace.getActiveSpan()
  const mergeBatches = async (batches: AsyncIterable<[bigint, ITimelineEvent<any>[]]>) => {
    let versionFromStream = -1n
    const eventBatches = []
    for await (const [version, messages] of batches) {
      versionFromStream = version
      eventBatches.push(messages)
    }
    const events = eventBatches.flat()
    span?.setAttributes({
      "eqx.batches": eventBatches.length,
      "eqx.count": events.length,
      "eqx.version": Number(versionFromStream),
    })
    return [versionFromStream, events] as const
  }
  span?.setAttributes({
    "eqx.batch_size": batchSize,
    "eqx.start_position": Number(startPosition),
    "eqx.load_method": "BatchForward",
    "eqx.require_leader": requiresLeader,
  })
  const readSlice = (start: bigint) =>
    readSliceAsync(reader, streamName, batchSize, start, requiresLeader)

  return mergeBatches(readBatches(readSlice, maxPermittedBatchReads, startPosition))
}

export function loadLastEvent(
  reader: MessageDbReader,
  requiresLeader: boolean,
  streamName: string,
  eventType?: string
) {
  const span = trace.getActiveSpan()
  span?.setAttribute("eqx.load_method", "Last")
  return readLastEventAsync(reader, streamName, requiresLeader, eventType).then((s) => {
    span?.setAttributes({
      "eqx.last_version": Number(s.lastVersion),
      "eqx.count": s.messages.length,
    })
    return [s.lastVersion, s.messages] as const
  })
}
