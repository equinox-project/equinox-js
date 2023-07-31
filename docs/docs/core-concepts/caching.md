# Caching

Out of the box EquinoxJS supports an in-memory LRU cache. This cache is based
on the lru-cache library. The default configuration allows 1,000,000 items to
live in the cache. Since it's impossible to know the size of a JS object in
bytes at runtime we cannot provide a sensible default for the cache that limits
the actual memory usage of your process. You'll need to fine tune it to your
actual requirements. As an example if you have 1 million states, each of which
is 50 bytes that's 50MB of memory.

The cache acts as a concurrency limiter on stream loads and guarantees that
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

No caching is applied. This necessitates a fresh load of the entire stream for every interaction with the
store.

## `Cache(cache, ?prefix)`

```ts
import { CachingStrategy, MemoryCache } from "@equinox-js/core"
const cache = new MemoryCache()
const strategy = CachingStrategy.Cache(cache)
```

Retain a single `state` per `stream_name` in the supplied cache.

Prefix is used to segregate multiple folds per stream when they are stored in the cache.

# LoadOptions

When transacting or querying on your decider you can supply a load option to
opt into different load guarantees.

## `RequireLoad`

This is the default load option, always obtaining the latest state from the store

## `RequireLader`

Request that the stream be loaded with a quorum read / from a leader connection

## MaxStale(ms)

If the cache contains a state from the stream that was stored less than `ms`
milliseconds ago that state will be used without fetching more events from the
stream.

## `AnyCachedValue`

If the cache contains any state from the stream, that state will be used without
fetching more events from the stream.

## `AssumeEmpty`

Instead of loading the stream, the empty state is supplied to the handler.
Useful when you're fairly certain the stream does not exist yet.
