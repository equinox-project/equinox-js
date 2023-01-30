import { baseIndex, Batch, enumEvents } from "./Batch"
import { Container } from "./Container"
import { fromTip, Position, toEtag } from "./Position"
import { unfoldToTimelineEvent } from "./Unfold"
import { eventToTimelineEvent } from "./Event"
import { TimelineEvent } from "@equinox-js/core"
import { InternalBody } from "./InternalBody"
import * as Tracing from "./Tracing"
import { context, SpanKind, trace } from "@opentelemetry/api"

export enum ResType {
  Found,
  NotFound,
  NotModified,
}
export type Res<T> = { type: ResType.Found; value: T } | { type: ResType.NotFound } | { type: ResType.NotModified }

const enumEventsAndUnfolds = (minIndex: bigint | undefined, maxIndex: bigint | undefined, x: Batch) => {
  const events = enumEvents(minIndex, maxIndex, x).map(eventToTimelineEvent)
  const unfolds = x.u.map(unfoldToTimelineEvent)
  return events.concat(unfolds).sort((a, b) => {
    if (a.index < b.index) return -1
    if (a.index > b.index) return 1
    if (a.isUnfold && !b.isUnfold) return 1
    if (!a.isUnfold && b.isUnfold) return -1
    return 0
  })
}

export async function tryLoad(container: Container, stream: string, consistentRead: boolean, pos?: Position, maxIndex?: bigint) {
  return Tracing.withSpan(
    "Tip.tryLoad",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "eqx.stream": stream,
        "eqx.require_leader": consistentRead,
      },
    },
    async (span): Promise<Res<[Position, bigint, TimelineEvent<InternalBody>[]]>> => {
      const tip = await container.tryGetTip(stream, consistentRead)
      if (tip == null) {
        span.setAttribute("eqx.result", "NotFound")
        return { type: ResType.NotFound }
      }
      if (toEtag(pos) === tip.etag) {
        span.setAttribute("eqx.result", "NotModified")
        return { type: ResType.NotModified }
      }
      span.setAttribute("eqx.result", "Found")
      return {
        type: ResType.Found,
        value: [fromTip(tip), baseIndex(tip), enumEventsAndUnfolds(pos?.index, maxIndex, tip)],
      }
    }
  )
}
