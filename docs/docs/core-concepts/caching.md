# Caching

Out of the box EquinoxJS supports a few strategies for caching. Caching in this context means that we'll keep 
a record of aggregate state and it's version in memory. The `MemoryCache` included in the core library is a simple
LRU cache which can keep up to a million states (configurable).

On top of the cache we have a few Caching strategies to choose from

# NoCaching

```ts
import { CachingStrategy } from "@equinox-js/core"
const strategy = CachingStrategy.noCache()
```

No caching is applied. This necessitates a fresh load of the entire stream for every interaction with the
store.

# SlidingWindow(cache, ms, ?prefix)

```ts
import { CachingStrategy, MemoryCache } from "@equinox-js/core"
const cache = new MemoryCache()
const strategy = CachingStrategy.slidingWindow(cache, 20 * 60 * 1000)
```

Retain a single `state` per `stream_name`.
Each cache hit for a stream renews the retention period for the defined `ms`.
Upon expiration of the defined `ms` from the point at which the cache was entry was last used, a full reload is
triggered.
Unless `LoadOption.AllowStale` is used, each cache hit still incurs a roundtrip to load any subsequently-added events.

Prefix is used to segregate multiple folds per stream when they are stored in the cache. 

# FixedTimeSpan(cache, periodMs)

```ts
import { CachingStrategy, MemoryCache } from "@equinox-js/core"
const cache = new MemoryCache()
const strategy = CachingStrategy.fixedTimeSpan(cache, 20 * 60 * 1000)
```

Retain a single `state` per `stream_name`.
Upon expiration of the defined `periodMs`, a full reload is triggered.
Unless `LoadOption.AllowStale` is used, each cache hit still incurs a roundtrip to load any subsequently-added events.

Prefix is used to segregate multiple folds per stream when they are stored in the cache. 
