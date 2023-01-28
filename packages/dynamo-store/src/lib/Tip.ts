import { baseIndex, Batch, enumEvents } from "./Batch"
import { Container } from "./Container"
import { fromTip, Position, toEtag } from "./Position"
import { unfoldToTimelineEvent } from "./Unfold"
import { eventToTimelineEvent } from "./Event"
import { TimelineEvent } from "@equinox-js/core"
import { InternalBody } from "./InternalBody"

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

export async function tryLoad(
  container: Container,
  stream: string,
  consistentRead: boolean,
  pos?: Position,
  maxIndex?: bigint
): Promise<Res<[Position, bigint, TimelineEvent<InternalBody>[]]>> {
  const tip = await container.tryGetTip(stream, consistentRead)
  if (tip == null) return { type: ResType.NotFound }
  if (toEtag(pos) === tip.etag) return { type: ResType.NotModified }
  return {
    type: ResType.Found,
    value: [fromTip(tip), baseIndex(tip), enumEventsAndUnfolds(pos?.index, maxIndex, tip)],
  }
}
