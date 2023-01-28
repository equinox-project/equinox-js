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
import { AccessStrategy } from "./AccessStrategy"

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
        const isOrigin = access.isOrigin
        const checkUnfolds = access.checkUnfolds
        const mapUnfolds = access.mapUnfolds
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
