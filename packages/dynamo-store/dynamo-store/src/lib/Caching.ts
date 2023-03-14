import { StreamToken, SyncResult, ICategory, CacheEntry, ICache, TokenAndState } from "@equinox-js/core"
import { Fold, IsOrigin, MapUnfolds } from "./Internal.js"
import { InternalCategory } from "./Category.js"
import * as Token from "./Token.js"

export class CachingCategory<E, S, C> implements ICategory<E, S, C> {
  private readonly cache: (streamName: string, inner: Promise<TokenAndState<S>>) => Promise<TokenAndState<S>>
  constructor(
    private readonly category: InternalCategory<E, S, C>,
    private readonly fold: Fold<E, S>,
    private readonly initial: S,
    private readonly isOrigin: IsOrigin<E>,
    private readonly tryReadCache: (stream: string) => Promise<TokenAndState<S> | undefined | null>,
    private readonly updateCache: (stream: string, value: TokenAndState<S>) => Promise<void>,
    private readonly checkUnfolds: boolean,
    private readonly mapUnfolds: MapUnfolds<E, S>
  ) {
    this.cache = async (streamName: string, inner: Promise<TokenAndState<S>>) => {
      const tokenAndState = await inner
      await updateCache(streamName, tokenAndState)
      return tokenAndState
    }
  }

  async load(categoryName: string, streamId: string, streamName: string, allowStale: boolean, requireLeader: boolean): Promise<TokenAndState<S>> {
    const cached = await this.tryReadCache(streamName)
    if (cached == null)
      return this.cache(streamName, this.category.load(streamName, requireLeader, this.initial, this.checkUnfolds, this.fold, this.isOrigin))
    if (cached && allowStale) return cached
    return this.cache(streamName, this.category.reload(streamName, requireLeader, cached.token, cached.state, this.fold, this.isOrigin))
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
  const options = { relative: slidingExpirationInMs }
  return function addOrUpdateSlidingExpirationCacheEntry(streamName: string, value: TokenAndState<S>) {
    return cache.updateIfNewer(prefix + streamName, options, Token.supersedes, CacheEntry.ofTokenAndState(value))
  }
}

export function applyCacheUpdatesWithFixedTimeSpan<E, S, C>(cache: ICache, prefix: string, lifetimeInMs: number) {
  return function addOrUpdateFixedLifetimeCacheEntry(streamName: string, value: TokenAndState<S>) {
    const expirationPoint = Date.now() + lifetimeInMs
    const options = { absolute: expirationPoint }
    return cache.updateIfNewer(prefix + streamName, options, Token.supersedes, CacheEntry.ofTokenAndState(value))
  }
}
