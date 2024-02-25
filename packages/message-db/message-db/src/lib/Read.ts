import { ITimelineEvent } from "@equinox-js/core"
import { Format, MessageDbReader } from "./MessageDbClient.js"
import { trace } from "@opentelemetry/api"
import { Tags } from "@equinox-js/core"

type Batch = {
  messages: ITimelineEvent<Format>[]
  isEnd: boolean
  version: bigint
}

const toBatch = (events: ITimelineEvent<Format>[], isLast: boolean): Batch => {
  const version = events.length === 0 ? 0n : events[events.length - 1].index + 1n
  return { messages: events, isEnd: isLast, version }
}

const readSliceAsync = async (
  reader: MessageDbReader,
  streamName: string,
  batchSize: number,
  startPos: bigint,
  requiresLeader: boolean,
) => {
  const page = await reader.readStream(streamName, startPos, batchSize, requiresLeader)
  const isLast = page.length < batchSize
  return toBatch(page, isLast)
}

const readLastEventAsync = async (
  reader: MessageDbReader,
  streamName: string,
  requiresLeader: boolean,
  eventType?: string,
): Promise<Batch> => {
  const events = await reader.readLastEvent(streamName, requiresLeader, eventType)
  return toBatch(events == null ? [] : [events], false)
}

async function* readBatches(
  readSlice: (start: bigint) => Promise<Batch>,
  maxPermittedReads: number | undefined,
  startPosition: bigint,
): AsyncIterable<[bigint, ITimelineEvent[]]> {
  const span = trace.getActiveSpan()
  let batchCount = 0
  let eventCount = 0
  let bytes = 0
  let slice: Batch
  do {
    if (maxPermittedReads && batchCount >= maxPermittedReads)
      throw new Error("Batch limit exceeded")
    slice = await readSlice(startPosition)
    if (slice.messages.length > 0) {
      yield [slice.version, slice.messages]
    }
    batchCount++
    eventCount += slice.messages.length
    bytes += slice.messages.reduce((acc, m) => acc + m.size, 0)
    startPosition = slice.version
  } while (!slice.isEnd)

  span?.setAttributes({
    [Tags.batches]: batchCount,
    [Tags.loaded_bytes]: bytes,
    [Tags.loaded_count]: eventCount,
    [Tags.read_version]: String(slice.version),
  })
}

export function loadForwardsFrom(
  reader: MessageDbReader,
  batchSize: number,
  maxPermittedBatchReads: number | undefined,
  streamName: string,
  minIndex: bigint,
  requiresLeader: boolean,
) {
  const span = trace.getActiveSpan()
  span?.setAttributes({
    [Tags.batch_size]: batchSize,
    [Tags.loaded_from_version]: String(minIndex),
    [Tags.load_method]: "BatchForward",
    [Tags.requires_leader]: requiresLeader,
  })
  const readSlice = (start: bigint) =>
    readSliceAsync(reader, streamName, batchSize, start, requiresLeader)

  return readBatches(readSlice, maxPermittedBatchReads, minIndex)
}

export async function loadLastEvent(
  reader: MessageDbReader,
  requiresLeader: boolean,
  streamName: string,
  eventType?: string,
) {
  const span = trace.getActiveSpan()
  span?.setAttribute(Tags.load_method, "Last")
  const s = await readLastEventAsync(reader, streamName, requiresLeader, eventType)
  span?.setAttributes({
    [Tags.read_version]: Number(s.version),
    [Tags.loaded_count]: s.messages.length,
  })
  return [s.version, s.messages] as const
}
