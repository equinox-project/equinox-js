import { IsOrigin, MapUnfolds } from "./Internal"

export type AccessStrategy<E, S> = { isOrigin: IsOrigin<E>; mapUnfolds: MapUnfolds<E, S>; checkUnfolds: boolean }

/**
 * Don't apply any optimized reading logic. Note this can be extremely RU cost prohibitive
 * and can severely impact system scalability. Should hence only be used with careful consideration.
 */
export const Unoptimized = <E, S>(): AccessStrategy<E, S> => ({
  isOrigin: () => false,
  mapUnfolds: { type: "None" },
  checkUnfolds: false,
})

/**
 * Load only the single most recent event defined in <c>'event</c> and trust that doing a <c>fold</c> from any such event
 * will yield a correct and complete state
 * In other words, the <c>fold</c> function should not need to consider either the preceding <c>'state</state> or <c>'event</c>s.
 * <remarks>
 * A copy of the event is also retained in the `Tip` document in order that the state of the stream can be
 * retrieved using a single (cached, etag-checked) point read.
 * </remarks
 */
export const LatestKnownEvent = <E, S>(): AccessStrategy<E, S> => ({
  isOrigin: () => true,
  mapUnfolds: { type: "Unfold", unfold: (events: E[]) => [events[events.length - 1]] },
  checkUnfolds: true,
})

/**
 * Allow a 'snapshot' event (and/or other events that that pass the <c>isOrigin</c> test) to be used to build the state
 * in lieu of folding all the events from the start of the stream, as a performance optimization.
 * <c>toSnapshot</c> is used to generate the <c>unfold</c> that will be held in the Tip document in order to
 * enable efficient reading without having to query the Event documents.
 */
export const Snapshot = <E, S>(isOrigin: IsOrigin<E>, toSnapshot: (s: S) => E): AccessStrategy<E, S> => ({
  isOrigin,
  mapUnfolds: { type: "Unfold", unfold: (_: E[], state: S) => [toSnapshot(state)] },
  checkUnfolds: true,
})

/**
 * Allow any events that pass the `isOrigin` test to be used in lieu of folding all the events from the start of the stream
 * When writing, uses `toSnapshots` to 'unfold' the <c>'state</c>, representing it as one or more Event records to be stored in
 * the Tip with efficient read cost.
 */
export const MultiSnapshot = <E, S>(isOrigin: IsOrigin<E>, toSnapshot: (s: S) => E[]): AccessStrategy<E, S> => ({
  isOrigin,
  mapUnfolds: { type: "Unfold", unfold: (_: E[], state: S) => toSnapshot(state) },
  checkUnfolds: true,
})

/**
 * Instead of actually storing the events representing the decisions, only ever update a snapshot stored in the Tip document
 * <remarks>In this mode, Optimistic Concurrency Control is necessarily based on the etag</remarks>
 */
export const RollingState = <E, S>(toSnapshot: (s: S) => E): AccessStrategy<E, S> => ({
  isOrigin: () => true,
  mapUnfolds: { type: "Transmute", transmute: (_: E[], s: S) => [[], [toSnapshot(s)]] },
  checkUnfolds: true,
})

/**
 * Allow produced events to be filtered, transformed or removed completely and/or to be transmuted to unfolds.
 * <remarks>
 * In this mode, Optimistic Concurrency Control is based on the etag (rather than the normal Expected Version strategy)
 * in order that conflicting updates to the state not involving the writing of an event can trigger retries.
 * </remarks>
 */
export const Custom = <E, S>(isOrigin: IsOrigin<E>, transmute: (es: E[], s: S) => [E[], E[]]): AccessStrategy<E, S> => ({
  isOrigin,
  mapUnfolds: { type: "Transmute", transmute },
  checkUnfolds: true,
})
