import * as InternalBody from "./InternalBody"
import { sumBy } from "./Array"
import { TimelineEvent } from "@equinox-js/core"

type InternalBody = InternalBody.InternalBody
export type Unfold = {
  /// Base: Stream Position (Version) of State from which this Unfold was generated
  i: bigint

  /// Generation datetime
  t: Date

  /// The Case (Event Type) of this snapshot, used to drive deserialization
  c: string // required

  /// Event body
  d: InternalBody // required

  /// Optional metadata, can be Empty
  m: InternalBody
}

const NIL = "00000000-0000-0000-0000-000000000000"

export const bytes = (x: Unfold) => x.c.length + InternalBody.bytes(x.d) + InternalBody.bytes(x.m) + 50

export const arrayBytes = sumBy(bytes)

export const unfoldToTimelineEvent = (x: Unfold): TimelineEvent<InternalBody> => ({
  id: NIL,
  time: x.t,
  type: x.c,
  data: x.d,
  meta: x.m,
  index: x.i,
  isUnfold: true,
  size: bytes(x),
})
