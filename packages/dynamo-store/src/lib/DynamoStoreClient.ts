import { Container } from "./Container"
import * as Token from "./Token"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { QueryOptions, StoreClient, TipOptions } from "./StoreClient"
import { defaultMaxItems, defaultTipMaxBytes, Fold, IsOrigin, MapUnfolds } from "./Internal"
import { AsyncCodec, Category, ICache, StreamToken } from "@equinox-js/core"
import { ICategory } from "@equinox-js/core/src"
import { applyCacheUpdatesWithFixedTimeSpan, applyCacheUpdatesWithSlidingExpiration, CachingCategory } from "./Caching"
import { InternalCategory } from "./Category"
import { EncodedBody } from "./EncodedBody"

export class DynamoStoreClient {
  private primaryTableToSecondary: (x: string) => string
  constructor(
    public readonly tableName: string,
    // Facilitates custom mapping of Stream Category Name to underlying Table and Stream names
    private readonly categoryAndStreamIdToTableAndStreamNames: (category: string, streamId: string) => [string, string],
    private readonly createContainer: (table: string) => Container,
    private readonly createFallbackContainer: (table: string) => Container | undefined,
    public readonly archiveTableName?: string,
    primaryTableToArchive?: (x: string) => string
  ) {
    this.primaryTableToSecondary = primaryTableToArchive ?? ((x: string) => x)
  }

  static build(
    client: DynamoDB,
    tableName: string,
    // Table name to use for archive store. Default: (if <c>archiveClient</c> specified) use same <c>tableName</c> but via <c>archiveClient</c>.
    archiveTableName?: string,
    // Client to use for archive store. Default: (if <c>archiveTableName</c> specified) use same <c>archiveTableName</c> but via <c>client</c>.
    // Events that have been archived and purged (and hence are missing from the primary) are retrieved from this Table
    archiveClient?: DynamoDB
  ) {
    const genStreamName = (categoryName: string, streamId: string) => `${categoryName}-${streamId}`
    const catAndStreamToTableStream = (categoryName: string, streamId: string): [string, string] => [tableName, genStreamName(categoryName, streamId)]
    const primaryContainer = (t: string) => new Container(t, client)
    const fallbackContainer =
      !archiveClient && !archiveTableName
        ? (_: string) => undefined
        : (primaryContainerName: string) => new Container(archiveTableName ?? primaryContainerName, archiveClient ?? client)
    return new DynamoStoreClient(tableName, catAndStreamToTableStream, primaryContainer, fallbackContainer, archiveTableName)
  }

  resolveContainerAndFallbackStream(categoryName: string, streamId: string): [Container, Container | undefined, string] {
    const [tableName, streamName] = this.categoryAndStreamIdToTableAndStreamNames(categoryName, streamId)
    const fallbackTable = this.primaryTableToSecondary(tableName)
    return [this.createContainer(tableName), this.createFallbackContainer(fallbackTable), streamName]
  }
}

export class DynamoStoreContext {
  public readonly tipOptions: TipOptions
  public readonly queryOptions: QueryOptions
  constructor(
    public readonly storeClient: DynamoStoreClient,
    // Maximum serialized event size to permit to accumulate in Tip before they get moved out to a standalone Batch. Default: 32K.
    maxBytes?: number,
    // Maximum number of events permitted in Tip. When this is exceeded, events are moved out to a standalone Batch. Default: limited by maxBytes
    maxEvents?: number,
    // Max number of Batches to return per paged query response. Default: 32.
    queryMaxItems?: number,
    // Maximum number of trips to permit when slicing the work into multiple responses limited by `queryMaxItems`. Default: unlimited.
    queryMaxRequests?: number,
    // Inhibit throwing when events are missing, but no Archive Table has been supplied as a fallback
    ignoreMissingEvents?: boolean
  ) {
    this.tipOptions = { maxEvents, maxBytes: maxBytes ?? defaultTipMaxBytes }
    this.queryOptions = {
      maxItems: queryMaxItems ?? defaultMaxItems,
      maxRequests: queryMaxRequests,
      ignoreMissingEvents: ignoreMissingEvents || false,
    }
  }

  resolveContainerClientAndStreamId(categoryName: string, streamId: string): [StoreClient, string] {
    const [container, fallback, streamName] = this.storeClient.resolveContainerAndFallbackStream(categoryName, streamId)
    return [new StoreClient(container, fallback, this.queryOptions, this.tipOptions), streamName]
  }
}

/**
 * For DynamoDB, caching is critical in order to reduce RU consumption.
 * As such, it can often be omitted, particularly if streams are short or there are snapshots being maintained
 */
export type CachingStrategy =
  /**
   * Do not apply any caching strategy for this Stream.
   * NB opting not to leverage caching when using DynamoDB can have significant implications for the scalability
   *   of your application, both in terms of latency and running costs.
   * While the cost of a cache miss can be ameliorated to varying degrees by employing an appropriate `AccessStrategy`
   *   [that works well and has been validated for your scenario with real data], even a cache with a low Hit Rate provides
   *   a direct benefit in terms of the number of Read and/or Write Request Charge Units (RCU)s that need to be provisioned for your Tables.
   */
  | { type: "NoCaching" }
  /**
   * Retain a single 'state per streamName, together with the associated etag.
   * Each cache hit for a stream renews the retention period for the defined <c>window</c>.
   * Upon expiration of the defined <c>window</c> from the point at which the cache was entry was last used, a full reload is triggered.
   * Unless <c>LoadOption.AllowStale</c> is used, each cache hit still incurs an etag-contingent Tip read (at a cost of a roundtrip with a 1RU charge if unmodified).
   * NB while a strategy like EventStore.Caching.SlidingWindowPrefixed is obviously easy to implement, the recommended approach is to
   * track all relevant data in the state, and/or have the `unfold` function ensure _all_ relevant events get held in the unfolds in Tip
   */
  | { type: "SlidingWindow"; cache: ICache; windowInMs: number }
  /**
   * Retain a single 'state per streamName, together with the associated etag.
   * Upon expiration of the defined <c>period</c>, a full reload is triggered.
   * Typically combined with `Equinox.LoadOption.AllowStale` to minimize loads.
   * Unless <c>LoadOption.AllowStale</c> is used, each cache hit still incurs an etag-contingent Tip read (at a cost of a roundtrip with a 1RU charge if unmodified).
   */
  | { type: "FixedTimeSpan"; cache: ICache; periodInMs: number }

export type AccessStrategy<E, S> =
  /**
   * Don't apply any optimized reading logic. Note this can be extremely RU cost prohibitive
   * and can severely impact system scalability. Should hence only be used with careful consideration.
   */
  | { type: "Unoptimized" }
  /**
   * Load only the single most recent event defined in <c>'event</c> and trust that doing a <c>fold</c> from any such event
   * will yield a correct and complete state
   * In other words, the <c>fold</c> function should not need to consider either the preceding <c>'state</state> or <c>'event</c>s.
   * <remarks>
   * A copy of the event is also retained in the `Tip` document in order that the state of the stream can be
   * retrieved using a single (cached, etag-checked) point read.
   * </remarks
   */
  | { type: "LatestKnownEvent" }
  /**
   * Allow a 'snapshot' event (and/or other events that that pass the <c>isOrigin</c> test) to be used to build the state
   * in lieu of folding all the events from the start of the stream, as a performance optimization.
   * <c>toSnapshot</c> is used to generate the <c>unfold</c> that will be held in the Tip document in order to
   * enable efficient reading without having to query the Event documents.
   */
  | { type: "Snapshot"; isOrigin: IsOrigin<E>; toSnapshot: (s: S) => E }
  /**
   * Allow any events that pass the `isOrigin` test to be used in lieu of folding all the events from the start of the stream
   * When writing, uses `toSnapshots` to 'unfold' the <c>'state</c>, representing it as one or more Event records to be stored in
   * the Tip with efficient read cost.
   */
  | { type: "MultiSnapshot"; isOrigin: IsOrigin<E>; toSnapshots: (s: S) => E[] }
  /**
   * Instead of actually storing the events representing the decisions, only ever update a snapshot stored in the Tip document
   * <remarks>In this mode, Optimistic Concurrency Control is necessarily based on the etag</remarks>
   */
  | { type: "RollingState"; toSnapshot: (s: S) => E }
  /**
   * Allow produced events to be filtered, transformed or removed completely and/or to be transmuted to unfolds.
   * <remarks>
   * In this mode, Optimistic Concurrency Control is based on the etag (rather than the normal Expected Version strategy)
   * in order that conflicting updates to the state not involving the writing of an event can trigger retries.
   * </remarks>
   */
  | { type: "Custom"; isOrigin: IsOrigin<E>; transmute: (es: E[], s: S) => [E[], E[]] }

export class DynamoStoreCategory<E, S, C> extends Category<E, S, C> {
  constructor(resolveInner: (categoryName: string, streamId: string) => readonly [ICategory<E, S, C>, string], empty: [StreamToken, S]) {
    super(resolveInner, empty)
  }

  static build<E, S, C>(
    context: DynamoStoreContext,
    codec: AsyncCodec<E, EncodedBody, C>,
    fold: Fold<E, S>,
    initial: S,
    caching: CachingStrategy,
    access: AccessStrategy<E, S>
  ) {
    const categories: Record<string, ICategory<E, S, C>> = {}
    const resolveCategory = (categoryName: string, storeClient: StoreClient) => {
      const createCategory = (): ICategory<E, S, C> => {
        const tryReadCache = caching.type === "NoCaching" ? (_: string) => Promise.resolve(undefined) : caching.cache.tryGet.bind(caching.cache)
        const updateCache =
          caching.type === "SlidingWindow"
            ? applyCacheUpdatesWithSlidingExpiration(caching.cache, "", caching.windowInMs)
            : caching.type === "FixedTimeSpan"
            ? applyCacheUpdatesWithFixedTimeSpan(caching.cache, "", caching.periodInMs)
            : () => Promise.resolve(undefined)
        const isOrigin =
          access.type === "Unoptimized"
            ? (_e: E) => false
            : access.type === "LatestKnownEvent"
            ? (_e: E) => true
            : access.type === "RollingState"
            ? (_e: E) => true
            : access.isOrigin
        const checkUnfolds = access.type !== "Unoptimized"
        const mapUnfolds: MapUnfolds<E, S> =
          access.type === "Unoptimized"
            ? { type: "None" }
            : access.type === "LatestKnownEvent"
            ? { type: "Unfold", unfold: (events: E[]) => [events[events.length - 1]] }
            : access.type === "Snapshot"
            ? { type: "Unfold", unfold: (_: E[], state: S) => [access.toSnapshot(state)] }
            : access.type === "MultiSnapshot"
            ? { type: "Unfold", unfold: (_: E[], s: S) => access.toSnapshots(s) }
            : access.type === "RollingState"
            ? { type: "Transmute", transmute: (_: E[], s: S) => [[], [access.toSnapshot(s)]] }
            : { type: "Transmute", transmute: access.transmute }

        const category = new InternalCategory<E, S, C>(storeClient, codec)
        return new CachingCategory<E, S, C>(category, fold, initial, isOrigin, tryReadCache, updateCache, checkUnfolds, mapUnfolds)
      }
      return categories[categoryName] ?? (categories[categoryName] = createCategory())
    }
    const resolveInner = (categoryName: string, streamId: string): [ICategory<E, S, C>, string] => {
      let [container, streamName] = context.resolveContainerClientAndStreamId(categoryName, streamId)
      return [resolveCategory(categoryName, container), streamName]
    }
    return new DynamoStoreCategory(resolveInner, [Token.empty, initial])
  }
}
