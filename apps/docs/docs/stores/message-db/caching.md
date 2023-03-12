# Caching

When caching is enabled a load of the stream will first check the cache for an entry. If one exists, it will incur a
roundtrip
to load any subsequently added events.

# NoCaching

By default no caching is applied. This necessitates a fresh load of the entire stream for every interaction with the
store.

# SlidingWindow(cache, ms)

Retain a single `state` per `stream_name`.
Each cache hit for a stream renews the retention period for the defined `ms`.
Upon expiration of the defined `ms` from the point at which the cache was entry was last used, a full reload is
triggered.
Unless `LoadOption.AllowStale` is used, each cache hit still incurs a roundtrip to load any subsequently-added events.

# SlidingWindowPrefixed(cache, prefix, ms)

Prefix is used to segregate multiple folds per stream when they are stored in the cache. Semantics are equivalent to
SlidingWindow

# FixedTimeSpan(cache, periodMs)

Retain a single `state` per `stream_name`.
Upon expiration of the defined `periodMs`, a full reload is triggered.
Unless `LoadOption.AllowStale` is used, each cache hit still incurs a roundtrip to load any subsequently-added events.
