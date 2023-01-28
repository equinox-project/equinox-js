import { Event } from "./Event"
import * as Batch from "./Batch"
import { Unfold } from "./Unfold"
export type Position = {
  index: bigint
  etag?: string
  calvedBytes: number
  baseBytes: number
  unfoldsBytes: number
  events: Event[]
}

export const fromTip = (x: Batch.Batch): Position => ({
  index: x.n,
  etag: x.etag,
  events: x.e,
  calvedBytes: x.b ?? 0,
  baseBytes: Batch.bytesBase(x),
  unfoldsBytes: Batch.bytesUnfolds(x),
})
export const fromElements = (p: string, b: number, n: bigint, e: Event[], u: Unfold[], etag: string) =>
  fromTip({
    p,
    b,
    i: -1n,
    n,
    e,
    u,
    etag,
  })

export const tryFromBatch = (x: Batch.Batch) => (Batch.isTip(x.i) ? fromTip(x) : undefined)
export const toIndex = (x?: Position) => x?.index ?? 0n
export const toEtag = (x?: Position) => x?.etag
export const toVersionAndStreamBytes: (x?: Position) => [bigint, number] = (x?: Position) => (x ? [x.index, x.calvedBytes + x.baseBytes] : [0n, 0])
export const null_ = (i: bigint): Position => ({
  index: i,
  etag: undefined,
  calvedBytes: 0,
  baseBytes: 0,
  unfoldsBytes: 0,
  events: [],
})

export const flatten = (x?: Position): Position => x ?? null_(0n)
