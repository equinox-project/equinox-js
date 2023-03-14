import { Event, arrayBytes as eventArrayBytes } from "./Event.js"
import { Unfold, arrayBytes as unfoldArrayBytes } from "./Unfold.js"
import { sumBy } from "./Array.js"

export type Batch = {
  streamName: string // "{streamName}"

  /** (Tip Batch only) Number of bytes held in predecessor Batches */
  bytes?: number

  /** base 'i' value for the Events held herein */
  index: bigint // tipMagicI for the Tip

  /** Marker on which compare-and-swap operations on Tip are predicated */
  etag?: string

  /** `i` value for successor batch (to facilitate identifying which Batch a given startPos is within) */
  version: bigint

  /** The Domain Events (as opposed to Unfolded Events in `u`) for this page of the stream */
  events: Event[]

  /** Compaction/Snapshot/Projection quasi-events */
  unfolds: Unfold[]
}

export const tipMagicI = BigInt(-1 >>> 1)
export const tableKeyForStreamTip = (stream: string) => ({
  p: { S: stream },
  i: { N: String(tipMagicI) },
})
export const isTip = (i: bigint) => i === tipMagicI

const MAX_INT64 = 9223372036854775807n

export const enumEvents = (minIndex = 0n, maxIndex = MAX_INT64, x: Batch) => x.events.filter((e) => minIndex <= e.index && e.index < maxIndex)

/// Computes base Index for the Item (`i` can bear the magic value TipI when the Item is the Tip)
export const baseIndex = (x: Batch) => x.version - BigInt(x.events.length)
export const bytesUnfolds = (x: Batch) => unfoldArrayBytes(x.unfolds)
export const bytesBase = (x: Batch) => 80 + x.streamName.length + (x.etag?.length || 0) + eventArrayBytes(x.events)
export const bytesTotal = sumBy((x: Batch) => bytesBase(x) + bytesUnfolds(x))
