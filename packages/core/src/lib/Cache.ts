import { StreamToken, SyncResult, TokenAndState } from "./Core.js"
import LRUCache from "lru-cache"
import { ICategory } from "./Category.js"
import { trace } from "@opentelemetry/api"

type Expiration = { absolute: number } | { relative: number }

export class CacheEntry<State> {
  constructor(
    public token: StreamToken,
    public state: State,
  ) {}

  updateIfNewer(supersedes: (a: StreamToken, b: StreamToken) => boolean, other: CacheEntry<State>) {
    if (supersedes(this.token, other.token)) {
      this.token = other.token
      this.state = other.state
    }
  }
  value(): TokenAndState<State> {
    return { token: this.token, state: this.state }
  }

  static ofTokenAndState<S>(x: TokenAndState<S>) {
    return new CacheEntry(x.token, x.state)
  }
}

export interface ICache {
  updateIfNewer<State>(
    key: string,
    expiration: Expiration,
    supersedes: (a: StreamToken, b: StreamToken) => boolean,
    entry: CacheEntry<State>,
  ): Promise<void>

  tryGet<State>(key: string): Promise<TokenAndState<State> | undefined>
}

type Supersedes = (a: StreamToken, b: StreamToken) => boolean

export class MemoryCache implements ICache {
  private readonly cache: LRUCache<string, CacheEntry<any>>
  constructor(max = 1_000_000, ttlInMs = 1000 * 60 * 20) {
    this.cache = new LRUCache({
      max,
      ttl: ttlInMs,
    })
  }

  async tryGet<State>(key: string): Promise<TokenAndState<State> | undefined> {
    return this.cache.get(key)?.value()
  }

  async updateIfNewer<State>(
    key: string,
    expiration: Expiration,
    supersedes: Supersedes,
    entry: CacheEntry<State>,
  ): Promise<void> {
    const ttl = "absolute" in expiration ? expiration.absolute - Date.now() : expiration.relative
    if (!this.cache.has(key)) {
      this.cache.set(key, entry, { ttl })
    } else {
      const current = this.cache.get(key)!
      current.updateIfNewer(supersedes, entry)
    }
  }
}

export interface IReloadableCategory<E, S, C> extends ICategory<E, S, C> {
  reload(streamName: string, requireLeader: boolean, t: TokenAndState<S>): Promise<TokenAndState<S>>
  supersedes: Supersedes
}

export interface ICachingStrategy {
  load<S>(streamName: string): Promise<TokenAndState<S> | undefined>
  store<S>(
    supersedes: Supersedes,
    streamName: string,
    value: Promise<TokenAndState<S>>,
  ): Promise<TokenAndState<S>>
}

class NoCaching implements ICachingStrategy {
  async load<S>(streamName: string): Promise<TokenAndState<S> | undefined> {
    return undefined
  }
  store<S>(
    supersedes: Supersedes,
    streamName: string,
    value: Promise<TokenAndState<S>>,
  ): Promise<TokenAndState<S>> {
    return value
  }
}

class SlidingWindow implements ICachingStrategy {
  constructor(
    private readonly cache: ICache,
    private readonly windowInMs: number,
    private readonly prefix = "",
  ) {}

  load<S>(streamName: string): Promise<TokenAndState<S> | undefined> {
    return this.cache.tryGet(this.prefix + streamName)
  }

  async store<S>(
    supersedes: Supersedes,
    streamName: string,
    value: Promise<TokenAndState<S>>,
  ): Promise<TokenAndState<S>> {
    const v = await value
    const key = this.prefix + streamName
    const expiration = { relative: this.windowInMs }
    await this.cache.updateIfNewer(key, expiration, supersedes, CacheEntry.ofTokenAndState(v))
    return v
  }
}

class FixedTimeSpan implements ICachingStrategy {
  constructor(
    private readonly cache: ICache,
    private readonly timeSpanInMs: number,
    private readonly prefix = "",
  ) {}

  load<S>(streamName: string): Promise<TokenAndState<S> | undefined> {
    return this.cache.tryGet(this.prefix + streamName)
  }

  async store<S>(
    supersedes: Supersedes,
    streamName: string,
    value: Promise<TokenAndState<S>>,
  ): Promise<TokenAndState<S>> {
    const v = await value
    const key = this.prefix + streamName
    const expiration = { absolute: Date.now() + this.timeSpanInMs }
    await this.cache.updateIfNewer(key, expiration, supersedes, CacheEntry.ofTokenAndState(v))
    return v
  }
}

export namespace CachingStrategy {
  export const slidingWindow = (
    cache: ICache,
    windowInMs: number,
    prefix?: string,
  ): ICachingStrategy => new SlidingWindow(cache, windowInMs, prefix)
  export const noCache = (): ICachingStrategy => new NoCaching()
  export const fixedTimeSpan = (
    cache: ICache,
    periodInMs: number,
    prefix?: string,
  ): ICachingStrategy => new FixedTimeSpan(cache, periodInMs, prefix)
}

export class CachingCategory<Event, State, Context> implements ICategory<Event, State, Context> {
  constructor(
    private readonly inner: IReloadableCategory<Event, State, Context>,
    private readonly strategy: ICachingStrategy,
  ) {}

  async load(
    categoryName: string,
    streamId: string,
    streamName: string,
    allowStale: boolean,
    requireLeader: boolean,
  ): Promise<TokenAndState<State>> {
    const cachedValue = await this.strategy.load<State>(streamName)
    trace.getActiveSpan()?.setAttributes({
      "eqx.cache_hit": cachedValue != null,
    })
    if (cachedValue && allowStale) return cachedValue
    if (cachedValue) {
      return this.strategy.store(
        this.inner.supersedes,
        streamName,
        this.inner.reload(streamName, requireLeader, cachedValue),
      )
    }
    return this.strategy.store(
      this.inner.supersedes,
      streamName,
      this.inner.load(categoryName, streamId, streamName, allowStale, requireLeader),
    )
  }

  async trySync(
    categoryName: string,
    streamId: string,
    streamName: string,
    context: Context,
    originToken: StreamToken,
    originState: State,
    events: Event[],
  ): Promise<SyncResult<State>> {
    const result = await this.inner.trySync(
      categoryName,
      streamId,
      streamName,
      context,
      originToken,
      originState,
      events,
    )
    switch (result.type) {
      case "Conflict":
        return {
          type: "Conflict",
          resync: () => this.strategy.store(this.inner.supersedes, streamName, result.resync()),
        }
      case "Written":
        await this.strategy.store(this.inner.supersedes, streamName, Promise.resolve(result.data))
        return { type: "Written", data: result.data }
    }
  }

  static apply<E, S, C>(inner: IReloadableCategory<E, S, C>, strategy: ICachingStrategy) {
    return new CachingCategory(inner, strategy)
  }
}
