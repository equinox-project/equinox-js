import { StreamToken, TokenAndState } from "./Core.js"
import LRUCache from "lru-cache"

type Expiration = { absolute: number } | { relative: number }

export class CacheEntry<State> {
  constructor(public token: StreamToken, public state: State) {}

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
    entry: CacheEntry<State>
  ): Promise<void>

  tryGet<State>(key: string): Promise<TokenAndState<State> | null>
}

export class MemoryCache implements ICache {
  private readonly cache: LRUCache<string, CacheEntry<any>>
  constructor(max = 1_000_000, ttlInMs = 1000 * 60 * 20) {
    this.cache = new LRUCache({
      max,
      ttl: ttlInMs,
    })
  }

  async tryGet<State>(key: string): Promise<TokenAndState<State> | null> {
    return this.cache.get(key)?.value() ?? null
  }

  async updateIfNewer<State>(
    key: string,
    expiration: Expiration,
    supersedes: (a: StreamToken, b: StreamToken) => boolean,
    entry: CacheEntry<State>
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
