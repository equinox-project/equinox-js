import { baseIndex, Batch, enumEvents } from "./Batch.js"
import { Container } from "./Container.js"
import { fromTip, Position, toEtag } from "./Position.js"
import { unfoldToTimelineEvent } from "./Unfold.js"
import { eventToTimelineEvent } from "./Event.js"
import { ITimelineEvent } from "@equinox-js/core"
import { InternalBody } from "./InternalBody.js"
import * as Tracing from "./Tracing.js"
import { SpanKind } from "@opentelemetry/api"

export enum ResType {
  Found,
  NotFound,
  NotModified,
}
export type Res<T> = { type: ResType.Found; value: T } | { type: ResType.NotFound } | { type: ResType.NotModified }

function compareITimelineEvents(a: ITimelineEvent<unknown>, b: ITimelineEvent<unknown>) {
  if (a.index < b.index) return -1
  if (a.index > b.index) return 1
  if (a.isUnfold && !b.isUnfold) return 1
  if (!a.isUnfold && b.isUnfold) return -1
  return 0
}

const enumEventsAndUnfolds = (minIndex: bigint | undefined, maxIndex: bigint | undefined, x: Batch) => {
  const events = enumEvents(minIndex, maxIndex, x).map(eventToTimelineEvent)
  const unfolds = x.unfolds.map(unfoldToTimelineEvent)
  return events.concat(unfolds).sort(compareITimelineEvents)
}

export type LoadedTip = {
  position: Position
  index: bigint
  events: ITimelineEvent<InternalBody>[]
}

export async function tryLoad(
  container: Container,
  stream: string,
  consistentRead: boolean,
  pos?: Position,
  maxIndex?: bigint
): Promise<Res<LoadedTip>> {
  return Tracing.withSpan(
    "Tip.tryLoad",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "eqx.stream": stream,
        "eqx.require_leader": consistentRead,
      },
    },
    async (span): Promise<Res<LoadedTip>> => {
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
        value: { position: fromTip(tip), index: baseIndex(tip), events: enumEventsAndUnfolds(pos?.index, maxIndex, tip) },
      }
    }
  )
}
