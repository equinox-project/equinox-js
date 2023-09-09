import { ITimelineEvent, StreamName, Tags } from "@equinox-js/core"
import { Attributes, SpanKind, SpanStatusCode, Tracer } from "@opentelemetry/api"

type EventHandler<Format> = (sn: StreamName, events: ITimelineEvent<Format>[]) => Promise<void>

export async function traceHandler<Format>(
  tracer: Tracer,
  attrs: Attributes,
  category: string,
  streamName: StreamName,
  events: ITimelineEvent<Format>[],
  handler: EventHandler<Format>,
) {
  const firstEventTimeStamp = events[events.length - 1]!.time.getTime()
  return tracer.startActiveSpan(
    `${category} process`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        [Tags.category]: category,
        [Tags.stream_name]: streamName,
        "eqx.stream_version": Number(events[events.length - 1]!.index),
        [Tags.loaded_count]: events.length,
        ...attrs,
      },
    },
    (span) =>
      handler(streamName, events)
        .catch((err) => {
          span.recordException(err)
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
          throw err
        })
        .finally(() => {
          span.setAttribute("eqx.lead_time_ms", Date.now() - firstEventTimeStamp)
          span.end()
        }),
  )
}
