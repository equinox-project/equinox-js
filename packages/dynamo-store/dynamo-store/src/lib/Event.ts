import * as InternalBody from "./InternalBody.js"
import { sumBy } from "./Array.js"
import { TimelineEvent } from "@equinox-js/core"

export type Event = {
  /** Index number within stream, not persisted (computed from Batch's `n` and the index within `e`) */
  index: bigint

  /** Creation Timestamp, as set by the application layer at the point of rendering the Event */
  timestamp: Date

  /** The Event Type (Case) that defines the content of the Data (and Metadata) fields */
  type: string

  /** Main event body; required */
  data: InternalBody.InternalBody

  /** Optional metadata, encoded as per 'd'; can be Empty */
  meta: InternalBody.InternalBody

  /** CorrelationId; stored as x (signifying transactionId), or null */
  correlationId?: string

  /** CausationId; stored as y (signifying why), or null */
  causationId?: string
}

const len = (x?: string) => x?.length ?? 0
export const bytes = (x: Event) => {
  return (
    x.type.length + InternalBody.bytes(x.data) + InternalBody.bytes(x.meta) + len(x.correlationId) + len(x.causationId) + 20 /*t*/ + 20
  ) /*overhead*/
}
export const arrayBytes = sumBy(bytes)

const NIL = "00000000-0000-0000-0000-000000000000"
export const eventToTimelineEvent = (x: Event): TimelineEvent<InternalBody.InternalBody> => ({
  id: NIL,
  time: x.timestamp,
  type: x.type,
  data: x.data,
  meta: x.meta,
  index: x.index,
  isUnfold: true,
  size: bytes(x),
})
