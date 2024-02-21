import { ITimelineEvent } from "@equinox-js/core"
import { Format, LibSqlReader } from "./LibSqlClient.js"
import { trace } from "@opentelemetry/api"
import { Tags } from "@equinox-js/core"

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
  reader: LibSqlReader,
  streamName: string,
  batchSize: number,
  startPos: bigint,
) => {
  const page = await reader.readStream(streamName, startPos, batchSize)
  const isLast = page.length < batchSize
  return toSlice(page, isLast)
}

const readLastEventAsync = async (
  reader: LibSqlReader,
  streamName: string,
  eventType?: string,
): Promise<StreamEventsSlice> => {
  const events = await reader.readLastEvent(streamName, eventType)
  return toSlice(events == null ? [] : [events], false)
}

async function* readBatches(
  readSlice: (start: bigint) => Promise<StreamEventsSlice>,
  maxPermittedReads: number | undefined,
  startPosition: bigint,
): AsyncIterable<[bigint, ITimelineEvent[]]> {
  const span = trace.getActiveSpan()
  let batchCount = 0
  let eventCount = 0
  let bytes = 0
  let slice: StreamEventsSlice
  do {
    if (maxPermittedReads && batchCount >= maxPermittedReads)
      throw new Error("Batch limit exceeded")
    slice = await readSlice(startPosition)
    yield [slice.lastVersion, slice.messages]
    batchCount++
    eventCount += slice.messages.length
    bytes += slice.messages.reduce((acc, m) => acc + m.size, 0)
    startPosition = slice.lastVersion + 1n
  } while (!slice.isEnd)

  span?.setAttributes({
    [Tags.batches]: batchCount,
    [Tags.loaded_bytes]: bytes,
    [Tags.loaded_count]: eventCount,
    [Tags.read_version]: String(slice.lastVersion),
  })
}

export function loadForwardsFrom(
  reader: LibSqlReader,
  batchSize: number,
  maxPermittedBatchReads: number | undefined,
  streamName: string,
  startPosition: bigint,
) {
  const span = trace.getActiveSpan()
  span?.setAttributes({
    [Tags.batch_size]: batchSize,
    [Tags.loaded_from_version]: String(startPosition),
    [Tags.load_method]: "BatchForward",
  })
  const readSlice = (start: bigint) => readSliceAsync(reader, streamName, batchSize, start)

  return readBatches(readSlice, maxPermittedBatchReads, startPosition)
}

export async function loadLastEvent(reader: LibSqlReader, streamName: string, eventType?: string) {
  const span = trace.getActiveSpan()
  span?.setAttribute(Tags.load_method, "Last")
  const s = await readLastEventAsync(reader, streamName, eventType)
  span?.setAttributes({
    [Tags.read_version]: Number(s.lastVersion),
    [Tags.loaded_count]: s.messages.length,
  })
  return [s.lastVersion, s.messages] as const
}
