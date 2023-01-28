import { Event, arrayBytes as eventArrayBytes } from "./Event"
import { Unfold, arrayBytes as unfoldArrayBytes } from "./Unfold"
import { sumBy } from "./Array"

export type Batch = {
  p: string // "{streamName}"

  /** (Tip Batch only) Number of bytes held in predecessor Batches */
  b?: number

  /** base 'i' value for the Events held herein */
  i: bigint // tipMagicI for the Tip

  /** Marker on which compare-and-swap operations on Tip are predicated */
  etag?: string

  /** `i` value for successor batch (to facilitate identifying which Batch a given startPos is within) */
  n: bigint

  /** The Domain Events (as opposed to Unfolded Events in `u`) for this page of the stream */
  e: Event[]

  /** Compaction/Snapshot/Projection quasi-events */
  u: Unfold[]
}

export const tipMagicI = BigInt(-1 >>> 1)
export const tableKeyForStreamTip = (stream: string) => ({
  p: { S: stream },
  i: { N: String(tipMagicI) },
})
export const isTip = (i: bigint) => i === tipMagicI

const MAX_INT64 = 9223372036854775807n

export const enumEvents = (minIndex = 0n, maxIndex = MAX_INT64, x: Batch) => x.e.filter((e) => minIndex <= e.i && e.i < maxIndex)

/// Computes base Index for the Item (`i` can bear the magic value TipI when the Item is the Tip)
export const baseIndex = (x: Batch) => x.n - BigInt(x.e.length)
export const bytesUnfolds = (x: Batch) => unfoldArrayBytes(x.u)
export const bytesBase = (x: Batch) => 80 + x.p.length + (x.etag?.length || 0) + eventArrayBytes(x.e)
export const bytesTotal = sumBy((x: Batch) => bytesBase(x) + bytesUnfolds(x))
