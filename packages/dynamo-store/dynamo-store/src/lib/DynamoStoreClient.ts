import { Container } from "./Container.js"
import * as Token from "./Token.js"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { QueryOptions, StoreClient, TipOptions } from "./StoreClient.js"
import { defaultMaxItems, defaultTipMaxBytes, Fold } from "./Internal.js"
import { Codec, Category, TokenAndState } from "@equinox-js/core"
import { ICategory } from "@equinox-js/core"
import { applyCacheUpdatesWithFixedTimeSpan, applyCacheUpdatesWithSlidingExpiration, CachingCategory } from "./Caching.js"
import { InternalCategory } from "./Category.js"
import { EncodedBody } from "./EncodedBody.js"
import { AccessStrategy } from "./AccessStrategy.js"
import { CachingStrategy } from "./CachingStrategy.js"

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

export class DynamoStoreCategory<E, S, C> extends Category<E, S, C> {
  constructor(resolveInner: (categoryName: string, streamId: string) => readonly [ICategory<E, S, C>, string], empty: TokenAndState<S>) {
    super(resolveInner, empty)
  }

  static build<E, S, C>(
    context: DynamoStoreContext,
    codec: Codec<E, EncodedBody, C>,
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
    return new DynamoStoreCategory(resolveInner, { token: Token.empty, state: initial })
  }
}
