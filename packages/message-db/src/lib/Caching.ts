import {
  StateTuple,
  StreamToken,
  SyncResult,
  ICategory,
  CacheEntry,
  ICache,
} from "@equinox-js/core"

class Decorator<Event, State, Context>
  implements ICategory<Event, State, Context>
{
  private readonly cache: (
    streamName: string,
    inner: Promise<[StreamToken, State]>
  ) => Promise<[StreamToken, State]>
  constructor(
    private readonly inner: ICategory<Event, State, Context>,
    private readonly updateCache: (
      key: string,
      value: [StreamToken, State]
    ) => Promise<void>
  ) {
    this.cache = async (
      streamName: string,
      inner: Promise<[StreamToken, State]>
    ) => {
      const tokenAndState = await inner
      await updateCache(streamName, tokenAndState)
      return tokenAndState
    }
  }

  load(
    categoryName: string,
    streamId: string,
    streamName: string,
    allowStale: boolean,
    requireLeader: boolean
  ): Promise<StateTuple<State>> {
    return this.cache(
      streamName,
      this.inner.load(
        categoryName,
        streamId,
        streamName,
        allowStale,
        requireLeader
      )
    )
  }

  async trySync(
    categoryName: string,
    streamId: string,
    streamName: string,
    context: Context,
    originToken: StreamToken,
    originState: State,
    events: Event[]
  ): Promise<SyncResult<State>> {
    const result = await this.inner.trySync(
      categoryName,
      streamId,
      streamName,
      context,
      originToken,
      originState,
      events
    )
    switch (result.type) {
      case "Conflict":
        return {
          type: "Conflict",
          resync: () => this.cache(streamName, result.resync()),
        }
      case "Written":
        await this.updateCache(streamName, result.data)
        return { type: "Written", data: result.data }
    }
  }
}

export function applyCacheUpdatesWithSlidingExpiration<E, S, C>(
  cache: ICache,
  prefix: string,
  slidingExpirationInMs: number,
  category: ICategory<E, S, C>,
  supersedes: (a: StreamToken, b: StreamToken) => boolean
) {
  const mkCacheEntry = ([initialToken, initialState]: [StreamToken, S]) =>
    new CacheEntry(initialToken, initialState)
  const options = { relative: slidingExpirationInMs }
  const addOrUpdateSlidingExpirationCacheEntry = (
    streamName: string,
    value: [StreamToken, S]
  ) =>
    cache.updateIfNewer(
      prefix + streamName,
      options,
      supersedes,
      mkCacheEntry(value)
    )

  return new Decorator<E, S, C>(
    category,
    addOrUpdateSlidingExpirationCacheEntry
  )
}

export function applyCacheUpdatesWithFixedTimeSpan<E, S, C>(
  cache: ICache,
  prefix: string,
  lifetimeInMs: number,
  category: ICategory<E, S, C>,
  supersedes: (a: StreamToken, b: StreamToken) => boolean
) {
  const mkCacheEntry = ([initialToken, initialState]: [StreamToken, S]) =>
    new CacheEntry(initialToken, initialState)
  const addOrUpdateFixedLifetimeCacheEntry = (
    streamName: string,
    value: [StreamToken, S]
  ) => {
    const expirationPoint = Date.now() + lifetimeInMs
    const options = { absolute: expirationPoint }
    return cache.updateIfNewer(
      prefix + streamName,
      options,
      supersedes,
      mkCacheEntry(value)
    )
  }
  return new Decorator(category, addOrUpdateFixedLifetimeCacheEntry)
}
