import { StateTuple, StreamToken, SyncResult, ICategory, CacheEntry, ICache } from "@equinox-js/core"
import { Fold, IsOrigin, MapUnfolds } from "./Internal"
import { InternalCategory } from "./Category"
import * as Token from "./Token"

export class CachingCategory<E, S, C> implements ICategory<E, S, C> {
  private readonly cache: (streamName: string, inner: Promise<[StreamToken, S]>) => Promise<[StreamToken, S]>
  constructor(
    private readonly category: InternalCategory<E, S, C>,
    private readonly fold: Fold<E, S>,
    private readonly initial: S,
    private readonly isOrigin: IsOrigin<E>,
    private readonly tryReadCache: (stream: string) => Promise<[StreamToken, S] | undefined | null>,
    private readonly updateCache: (stream: string, value: [StreamToken, S]) => Promise<void>,
    private readonly checkUnfolds: boolean,
    private readonly mapUnfolds: MapUnfolds<E, S>
  ) {
    this.cache = async (streamName: string, inner: Promise<[StreamToken, S]>) => {
      const tokenAndState = await inner
      await updateCache(streamName, tokenAndState)
      return tokenAndState
    }
  }

  async load(categoryName: string, streamId: string, streamName: string, allowStale: boolean, requireLeader: boolean): Promise<StateTuple<S>> {
    const cached = await this.tryReadCache(streamName)
    if (cached == null)
      return this.cache(streamName, this.category.load(streamName, requireLeader, this.initial, this.checkUnfolds, this.fold, this.isOrigin))
    if (cached && allowStale) return cached
    return this.cache(streamName, this.category.reload(streamName, requireLeader, cached[0], cached[1], this.fold, this.isOrigin))
  }

  async trySync(
    categoryName: string,
    streamId: string,
    streamName: string,
    context: C,
    originToken: StreamToken,
    originState: S,
    events: E[]
  ): Promise<SyncResult<S>> {
    const result = await this.category.sync(streamName, originToken, originState, events, this.mapUnfolds, this.fold, this.isOrigin, context)
    switch (result.type) {
      case "Conflict":
        return { type: "Conflict", resync: () => this.cache(streamName, result.resync()) }
      case "Written": {
        await this.updateCache(streamName, result.data)
        return result
      }
    }
  }
}

export function applyCacheUpdatesWithSlidingExpiration<E, S, C>(cache: ICache, prefix: string, slidingExpirationInMs: number) {
  const mkCacheEntry = ([initialToken, initialState]: [StreamToken, S]) => new CacheEntry(initialToken, initialState)
  const options = { relative: slidingExpirationInMs }
  const addOrUpdateSlidingExpirationCacheEntry = (streamName: string, value: [StreamToken, S]) =>
    cache.updateIfNewer(prefix + streamName, options, Token.supersedes, mkCacheEntry(value))
  return addOrUpdateSlidingExpirationCacheEntry
}

export function applyCacheUpdatesWithFixedTimeSpan<E, S, C>(cache: ICache, prefix: string, lifetimeInMs: number) {
  const mkCacheEntry = ([initialToken, initialState]: [StreamToken, S]) => new CacheEntry(initialToken, initialState)
  const addOrUpdateFixedLifetimeCacheEntry = (streamName: string, value: [StreamToken, S]) => {
    const expirationPoint = Date.now() + lifetimeInMs
    const options = { absolute: expirationPoint }
    return cache.updateIfNewer(prefix + streamName, options, Token.supersedes, mkCacheEntry(value))
  }
  return addOrUpdateFixedLifetimeCacheEntry
}
