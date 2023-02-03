import { DynamoDBStreamEvent } from "aws-lambda"
import { AppendsEpoch, AppendsIndex, AppendsTrancheId, DynamoStoreIndexer, IndexStreamId } from "@equinox-js/dynamo-store-indexer"
import { SpanStatusCode, trace } from "@opentelemetry/api"

const tracer = trace.getTracer("@equinox-js/dynamo-store-indexer-lambda")

const parse = (records: DynamoDBStreamEvent["Records"]): AppendsEpoch.Events.StreamSpan[] => {
  const span = tracer.startSpan("parseEvent")
  const spans: AppendsEpoch.Events.StreamSpan[] = []
  let summary = "",
    indexStream = 0,
    noEvents = 0
  try {
    for (const record of records) {
      if (record.dynamodb?.StreamViewType !== "NEW_IMAGE" && record.dynamodb?.StreamViewType !== "NEW_AND_OLD_IMAGES") {
        throw new Error("Unexpected StreamViewType " + record.dynamodb?.StreamViewType)
      }
      summary += String(record.eventName)[0]
      const updated = record.dynamodb.NewImage!
      switch (record.eventName) {
        case "REMOVE":
          break
        case "INSERT":
        case "MODIFY": {
          const p = record.dynamodb.Keys!.p.S!
          const sn = IndexStreamId.ofString(p)
          const n = Number(updated.n.N)
          const appendedLen = Number(updated.a.N)
          // Is a system stream
          if (p[0] === "$") indexStream++
          else if (appendedLen === 0) noEvents++
          else {
            const allBatchEventTypes = updated!.c.L!.map((x) => x.S!)
            const appendedEventTypes = allBatchEventTypes.slice(allBatchEventTypes.length - appendedLen)
            if (appendedEventTypes.length > 0) {
              const i = n - appendedEventTypes.length
              spans.push({ p: sn, i: i, c: appendedEventTypes })
              const et = appendedEventTypes.length === 1 ? ":" + appendedEventTypes[0] : `${appendedEventTypes[0]}+${appendedEventTypes.length - 1}`
              summary = summary + p + et + (i === 0 ? " " : `@${i.toString()}`)
            }
          }
          break
        }

        default:
          throw new Error("Unexpected OperationType " + record.eventName)
      }
      span.setAttributes({
        index_count: indexStream,
        no_events_count: noEvents,
        span_count: spans.length,
        summary,
      })
    }

    return spans
  } catch (err: any) {
    span.recordException(err)
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message })
    throw err
  } finally {
    span.end()
  }
}

export const handle = async (service: DynamoStoreIndexer, evt: DynamoDBStreamEvent["Records"]) => {
  const spans = parse(evt)
  if (spans.length === 0) return
  // TOCONSIDER if there are multiple shards, they should map to individual TrancheIds in order to avoid continual concurrency violations from competing writers
  await service.ingestWithoutConcurrency(AppendsTrancheId.wellKnownId, spans)
}
