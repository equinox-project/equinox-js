import { ICache } from "@equinox-js/core"

/**
 * For DynamoDB, caching is critical in order to reduce RU consumption.
 * As such, it can often be omitted, particularly if streams are short or there are snapshots being maintained
 */
export type CachingStrategy =
  | { type: "NoCaching" }
  | { type: "SlidingWindow"; cache: ICache; windowInMs: number }
  | { type: "FixedTimeSpan"; cache: ICache; periodInMs: number }

/**
 * Do not apply any caching strategy for this Stream.
 * NB opting not to leverage caching when using DynamoDB can have significant implications for the scalability
 *   of your application, both in terms of latency and running costs.
 * While the cost of a cache miss can be ameliorated to varying degrees by employing an appropriate `AccessStrategy`
 *   [that works well and has been validated for your scenario with real data], even a cache with a low Hit Rate provides
 *   a direct benefit in terms of the number of Read and/or Write Request Charge Units (RCU)s that need to be provisioned for your Tables.
 */
export const NoCaching = (): CachingStrategy => ({ type: "NoCaching" })
/**
 * Retain a single 'state per streamName, together with the associated etag.
 * Each cache hit for a stream renews the retention period for the defined <c>window</c>.
 * Upon expiration of the defined <c>window</c> from the point at which the cache was entry was last used, a full reload is triggered.
 * Unless <c>LoadOption.AllowStale</c> is used, each cache hit still incurs an etag-contingent Tip read (at a cost of a roundtrip with a 1RU charge if unmodified).
 * NB while a strategy like EventStore.Caching.SlidingWindowPrefixed is obviously easy to implement, the recommended approach is to
 * track all relevant data in the state, and/or have the `unfold` function ensure _all_ relevant events get held in the unfolds in Tip
 */
export const SlidingWindow = (cache: ICache, windowInMs: number): CachingStrategy => ({
  type: "SlidingWindow",
  cache,
  windowInMs,
})

/**
 * Retain a single 'state per streamName, together with the associated etag.
 * Upon expiration of the defined <c>period</c>, a full reload is triggered.
 * Typically combined with `Equinox.LoadOption.AllowStale` to minimize loads.
 * Unless <c>LoadOption.AllowStale</c> is used, each cache hit still incurs an etag-contingent Tip read (at a cost of a roundtrip with a 1RU charge if unmodified).
 */
export const FixedTimeSpan = (cache: ICache, periodInMs: number): CachingStrategy => ({
  type: "FixedTimeSpan",
  cache,
  periodInMs,
})
