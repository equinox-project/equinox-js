# Caching

Out of the box EquinoxJS supports an in-memory LRU cache. This cache is based
on the lru-cache library. The default configuration allows 1,000,000 items to
live in the cache. Since it's impossible to know the size of a JS object in
bytes at runtime we cannot provide a sensible default for the cache that limits
the actual memory usage of your process. You'll need to fine tune it to your
actual requirements. As an example if you have 1 million states, each of which
is 50 bytes that's 50MB of memory.

The cache doubles as a concurrency limiter on stream loads and guarantees that
for each stream at most one load is happening concurrently.

For performance reasons we do not offer TTL functionality on the cache. Doing
so with the guarantees we'd want is not feasible with the underlying cache
library. In particular, the underlying library will not pre-emptively evict
expired items from the cache and as such your items would remain in the cache
until requested again, at which point they'd be evicted. As such caching in
EquinoxJS is a binary on/off setting.

## `NoCaching`

```ts
import { CachingStrategy } from "@equinox-js/core"
const strategy = CachingStrategy.NoCache()
```

No caching is applied. This triggers a fresh load of the entire stream for every interaction with the
store.

## `Cache(cache, ?prefix)`

```ts
import { CachingStrategy, MemoryCache } from "@equinox-js/core"
const cache = new MemoryCache()
const strategy = CachingStrategy.Cache(cache)
```

Retain a single `state` per `stream_name` in the supplied cache.

Prefix is used to segregate multiple folds per stream when they are stored in the cache.

