import { StreamToken } from "@equinox-js/core"

export enum ISR {
  Written,
  ConflictUnknown,
}
export type InternalSyncResult = { type: ISR.Written; token: StreamToken } | { type: ISR.ConflictUnknown }

export enum LFTR {
  Unchanged,
  Found,
}
export type LoadFromTokenResult<Event> = { type: LFTR.Unchanged } | { type: LFTR.Found; token: StreamToken; events: Event[] }

// Item writes are charged in 1K blocks; reads in 4K blocks.
// Selecting an appropriate limit is a trade-off between
// - Read costs, Table Item counts and database usage (fewer, larger Items will imply lower querying and storage costs)
// - Tip Write costs - appending an event also incurs a cost to rewrite the existing content of the Tip
// - Uncached roundtrip latency - using the normal access strategies, the Tip is loaded as a point read before querying is triggered.
//   Ideally that gets all the data - smaller tip sizes reduce the likelihood of that
// - Calving costs - Calving a batch from the Tip every time is cost-prohibitive for at least the following reasons
//   - TransactWriteItems is more than twice the cost in Write RU vs a normal UpdateItem, with associated latency impacts
//   - various other considerations, e.g. we need to re-read the Tip next time around see https://stackoverflow.com/a/71706015/11635
export const defaultTipMaxBytes = 32 * 1024
// In general we want to minimize round-trips, but we'll get better diagnostic feedback under load if we constrain our
// queries to shorter pages. The effect of this is of course highly dependent on the max Item size, which is
// dictated by the TipOptions - in the default configuration that's controlled by defaultTipMaxBytes
export const defaultMaxItems = 32

export type Fold<E, S> = (state: S, events: E[]) => S
export type IsOrigin<E> = (e: E) => boolean

export type MapUnfolds<E, S> =
  | { type: "None" }
  | { type: "Unfold"; unfold: (events: E[], state: S) => E[] }
  | { type: "Transmute"; transmute: (events: E[], state: S) => [E[], E[]] }
