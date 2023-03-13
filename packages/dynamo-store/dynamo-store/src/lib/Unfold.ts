import * as InternalBody from "./InternalBody"
import { sumBy } from "./Array"
import { TimelineEvent } from "@equinox-js/core"

type InternalBody = InternalBody.InternalBody
export type Unfold = {
  /// Base: Stream Position (Version) of State from which this Unfold was generated
  index: bigint

  /// Generation datetime
  timestamp: Date

  /// The Case (Event Type) of this snapshot, used to drive deserialization
  type: string // required

  /// Event body
  data: InternalBody // required

  /// Optional metadata, can be Empty
  meta: InternalBody
}

const NIL = "00000000-0000-0000-0000-000000000000"

export const bytes = (x: Unfold) => x.type.length + InternalBody.bytes(x.data) + InternalBody.bytes(x.meta) + 50

export const arrayBytes = sumBy(bytes)

export const unfoldToTimelineEvent = (x: Unfold): TimelineEvent<InternalBody> => ({
  id: NIL,
  time: x.timestamp,
  type: x.type,
  data: x.data,
  meta: x.meta,
  index: x.index,
  isUnfold: true,
  size: bytes(x),
})
