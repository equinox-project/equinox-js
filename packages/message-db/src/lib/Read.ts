import { TimelineEvent } from "@equinox-js/core"
import { Format, MessageDbReader } from "./MessageDbClient.js"
import { context, SpanKind, trace } from "@opentelemetry/api"

const tracer = trace.getTracer("@equinox-js/message-db", "1.0.0")

type StreamEventsSlice = {
  messages: TimelineEvent<Format>[]
  isEnd: boolean
  lastVersion: bigint
}

const toSlice = (events: TimelineEvent<Format>[], isLast: boolean): StreamEventsSlice => {
  const lastVersion = events.length === 0 ? -1n : events[events.length - 1].index
  return { messages: events, isEnd: isLast, lastVersion }
}

const readSliceAsync = async (reader: MessageDbReader, streamName: string, batchSize: number, startPos: bigint, requiresLeader: boolean) => {
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

function loggedReadSlice(
  reader: MessageDbReader,
  streamName: string,
  batchSize: number,
  startPos: bigint,
  batchIndex: number,
  requiresLeader: boolean
) {
  return tracer.startActiveSpan(
    "ReadSlice",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "eqx.stream_name": streamName,
        "eqx.batch_index": batchIndex,
        "eqx.start_position": Number(startPos),
        "eqx.requires_leader": requiresLeader,
      },
    },
    (span) =>
      readSliceAsync(reader, streamName, batchSize, startPos, requiresLeader)
        .then((slice) => {
          span.setAttributes({
            "eqx.count": slice.messages.length,
            "eqx.last_version": Number(slice.lastVersion),
          })
          return slice
        })
        .finally(() => span.end())
  )
}

function readBatches(
  readSlice: (start: bigint, index: number) => Promise<StreamEventsSlice>,
  maxPermittedReads: number | undefined,
  startPosition: bigint
) {
  async function* loop(batchCount: number, pos: bigint): AsyncIterable<[bigint, TimelineEvent<any>[]]> {
    if (maxPermittedReads && batchCount >= maxPermittedReads) throw new Error("Batch limit exceeded")
    const slice = await readSlice(pos, batchCount)
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
  const mergeBatches = async (batches: AsyncIterable<[bigint, TimelineEvent<any>[]]>) => {
    let versionFromStream = -1n
    const events = []
    for await (const [version, messages] of batches) {
      versionFromStream = version
      for (let i = 0; i < messages.length; ++i) events.push(messages[i])
    }
    return [versionFromStream, events] as const
  }
  const span = trace.getSpan(context.active())
  span?.setAttributes({
    "eqx.batch_size": batchSize,
    "eqx.start_position": Number(startPosition),
    "eqx.load_method": "BatchForward",
    "eqx.require_leader": requiresLeader,
  })
  const readSlice = (start: bigint, index: number) => loggedReadSlice(reader, streamName, batchSize, start, index, requiresLeader)

  return mergeBatches(readBatches(readSlice, maxPermittedBatchReads, startPosition))
}

export function loadLastEvent(reader: MessageDbReader, requiresLeader: boolean, streamName: string, eventType?: string) {
  trace.getSpan(context.active())?.setAttribute("eqx.load_method", "Last")
  return tracer.startActiveSpan(
    "ReadLast",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "eqx.stream_name": streamName,
        "eqx.require_leader": requiresLeader,
      },
    },
    (span) =>
      readLastEventAsync(reader, streamName, requiresLeader, eventType)
        .then((s) => {
          span.setAttribute("eqx.last_version", Number(s.lastVersion))
          return [s.lastVersion, s.messages] as const
        })
        .finally(() => span.end())
  )
}
