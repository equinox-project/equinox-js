import * as InternalBody from "./InternalBody"
import { sumBy } from "./Array"
import { TimelineEvent } from "@equinox-js/core"

export type Event = {
  /** Index number within stream, not persisted (computed from Batch's `n` and the index within `e`) */
  i: bigint

  /** Creation Timestamp, as set by the application layer at the point of rendering the Event */
  t: Date

  /** The Event Type (Case) that defines the content of the Data (and Metadata) fields */
  c: string

  /** Main event body; required */
  d: InternalBody.InternalBody

  /** Optional metadata, encoded as per 'd'; can be Empty */
  m: InternalBody.InternalBody

  /** CorrelationId; stored as x (signifying transactionId), or null */
  correlationId?: string

  /** CausationId; stored as y (signifying why), or null */
  causationId?: string
}

const len = (x?: string) => x?.length ?? 0
export const bytes = (x: Event) => {
  return x.c.length + InternalBody.bytes(x.d) + InternalBody.bytes(x.m) + len(x.correlationId) + len(x.causationId) + 20 /*t*/ + 20 /*overhead*/
}
export const arrayBytes = sumBy(bytes)

const NIL = "00000000-0000-0000-0000-000000000000"
export const eventToTimelineEvent = (x: Event): TimelineEvent<InternalBody.InternalBody> => ({
  id: NIL,
  time: x.t,
  type: x.c,
  data: x.d,
  meta: x.m,
  index: x.i,
  isUnfold: true,
  size: bytes(x),
})
