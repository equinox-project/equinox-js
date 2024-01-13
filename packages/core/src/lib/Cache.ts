import { StreamToken, SyncResult, TokenAndState } from "./Core.js"
import LRUCache from "lru-cache"
import { ICategory } from "./Category.js"
import { trace } from "@opentelemetry/api"
import * as Tags from "./Tags.js"
import { StreamId } from "./StreamId.js"

type Supersedes = (a: StreamToken, b: StreamToken) => boolean

export class CacheEntry<T> {
  constructor(
    public token: StreamToken,
    public state: T,
    public cachedAt: number,
  ) {}

  updateIfNewer(supersedes: Supersedes, other: CacheEntry<T>) {
    if (supersedes(this.token, other.token)) {
      this.token = other.token
      this.state = other.state
    }
    this.updateCachedAt(Date.now())
  }

  updateCachedAt(now: number) {
    this.cachedAt = now
  }
  value(): TokenAndState<T> {
    return { token: this.token, state: this.state }
  }

  static ofTokenAndState<S>(x: TokenAndState<S>) {
    return new CacheEntry(x.token, x.state, Date.now())
  }
}

export interface ICache {
  readThrough<State>(
    key: string,
    skipReloadIfYoungerThanMs: number,
    supersedes: Supersedes,
    read: (tokenAndState?: TokenAndState<State>) => Promise<TokenAndState<State>>,
    ttl?: number,
  ): Promise<TokenAndState<State>>

  updateIfNewer<State>(
    key: string,
    supersedes: Supersedes,
    entry: CacheEntry<State>,
    ttl?: number,
  ): void
}

export class MemoryCache implements ICache {
  private readonly cache: LRUCache<string, CacheEntry<any>>
  /**
   * It's not possible to know the size of a JS object in bytes at runtime,
   * as such we cannot provide a sensible default for the cache that limits
   * the actual memory usage of your process. You'll need to fine tune it to your
   * requirements. By default we allow 1 million entries in the cache.
   * If each entry is 50 bytes that's 50MB of memory.
   *
   * @param max Maximum number of entries to cache
   */
  constructor(max = 1_000_000) {
    this.cache = new LRUCache({
      max,
      allowStale: true,
      // we disable autopurge because it creates a timer for each item
      // we instead create an interval that purges the stale items every 5s
      ttlAutopurge: false,
    })
    this.startPurgeTimer()
  }

  private startPurgeTimer() {
    setInterval(() => {
      this.cache.purgeStale()
    }, 5000).unref()
  }

  loadsInProgress: Map<string, Promise<any>> = new Map()

  private readWithExactlyOneFetch<State>(
    key: string,
    supersedes: Supersedes,
    read: () => Promise<TokenAndState<State>>,
    ttl?: number,
  ) {
    const fetcher = this.loadsInProgress.get(key)
    if (fetcher) return fetcher
    const p = read()
      .then((tns) => {
        this.updateIfNewer(key, supersedes, CacheEntry.ofTokenAndState(tns), ttl)
        return tns
      })
      .finally(() => {
        this.loadsInProgress.delete(key)
      })
    this.loadsInProgress.set(key, p)
    return p
  }

  async readThrough<State>(
    key: string,
    skipReloadIfYoungerThanMs: number,
    supersedes: Supersedes,
    read: (tns?: TokenAndState<State>) => Promise<TokenAndState<State>>,
    ttl?: number,
  ): Promise<TokenAndState<State>> {
    const span = trace.getActiveSpan()
    const current = this.cache.get(key)
    span?.setAttribute(Tags.cache_hit, !!current)
    span?.setAttribute(Tags.max_staleness, skipReloadIfYoungerThanMs)
    if (!current) {
      return this.readWithExactlyOneFetch(key, supersedes, () => read(), ttl)
    }
    const now = Date.now()
    const age = now - current.cachedAt
    span?.setAttribute(Tags.cache_age, age)
    if (age < skipReloadIfYoungerThanMs) {
      return current.value()
    }
    return this.readWithExactlyOneFetch(key, supersedes, () => read(current.value()), ttl)
  }

  updateIfNewer<State>(
    key: string,
    supersedes: Supersedes,
    entry: CacheEntry<State>,
    ttl?: number,
  ): void {
    const current = this.cache.get(key)
    if (!current) {
      this.cache.set(key, entry, { ttl })
    } else {
      current.updateIfNewer(supersedes, entry)
    }
  }
}

export interface IReloadableCategory<E, S, C> extends ICategory<E, S, C> {
  reload(streamId: StreamId, requireLeader: boolean, t: TokenAndState<S>): Promise<TokenAndState<S>>
  supersedes: Supersedes
}

export interface ICachingStrategy {
  cache: ICache
  cacheKey: (streamName: string) => string
  ttl: number
}

export namespace CachingStrategy {
  export const CacheTtl = (cache: ICache, ttl: number, prefix?: string): ICachingStrategy => ({
    cache,
    cacheKey: (streamName: string) => (prefix || "") + streamName,
    ttl,
  })
  export const Cache = (cache: ICache, prefix?: string): ICachingStrategy => ({
    cache,
    cacheKey: (streamName: string) => (prefix || "") + streamName,
    ttl: 0,
  })
  export const NoCache = (): ICachingStrategy | undefined => undefined
}

export class CachingCategory<Event, State, Context> implements ICategory<Event, State, Context> {
  constructor(
    private readonly categoryName: string,
    private readonly inner: IReloadableCategory<Event, State, Context>,
    private readonly strategy: ICachingStrategy,
  ) {}

  private cacheKey(streamId: string) {
    return this.strategy.cacheKey(`${this.categoryName}/${streamId}`)
  }

  load(
    streamId: StreamId,
    maxStaleMs: number,
    requireLeader: boolean,
  ): Promise<TokenAndState<State>> {
    const reload = (tns?: TokenAndState<State>) =>
      tns
        ? this.inner.reload(streamId, requireLeader, tns)
        : this.inner.load(streamId, maxStaleMs, requireLeader)
    return this.strategy.cache.readThrough(
      this.cacheKey(streamId),
      maxStaleMs,
      this.inner.supersedes,
      reload,
      this.strategy.ttl,
    )
  }

  async sync(
    streamId: StreamId,
    context: Context,
    originToken: StreamToken,
    originState: State,
    events: Event[],
  ): Promise<SyncResult<State>> {
    const result = await this.inner.sync(streamId, context, originToken, originState, events)
    switch (result.type) {
      case "Conflict":
        return {
          type: "Conflict",
          resync: async () => {
            const res = await result.resync()
            this.strategy.cache.updateIfNewer(
              this.cacheKey(streamId),
              this.inner.supersedes,
              CacheEntry.ofTokenAndState(res),
              this.strategy.ttl,
            )
            return res
          },
        }
      case "Written":
        this.strategy.cache.updateIfNewer(
          this.cacheKey(streamId),
          this.inner.supersedes,
          CacheEntry.ofTokenAndState(result.data),
          this.strategy.ttl,
        )
        return { type: "Written", data: result.data }
    }
  }

  static apply<E, S, C>(
    categoryName: string,
    inner: IReloadableCategory<E, S, C>,
    strategy?: ICachingStrategy,
  ): ICategory<E, S, C> {
    if (!strategy) return inner
    return new CachingCategory(categoryName, inner, strategy)
  }
}
