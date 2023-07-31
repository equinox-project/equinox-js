# LoadOptions

When transacting or querying on your decider you can supply a load option to
opt into different load guarantees.

## `RequireLoad`

This is the default load option, always obtaining the latest state from the store

```ts
const decider = this.resolve(id)
return decider.transact(decide, LoadOption.Requireload)
```

## `RequireLeader`

Request that the stream be loaded with a quorum read / from a leader connection

```ts
const decider = this.resolve(id)
return decider.transact(decide, LoadOption.RequireLeader)
```

## `MaxStale(ms)`

If the cache contains a state from the stream that was read less than `ms`
milliseconds ago that state will be used without fetching more events from the
stream.

```ts
const decider = this.resolve(id)
// tolerate 50s of staleness
return decider.transact(decide, LoadOption.MaxStale(50000))
```

## `AnyCachedValue`

If the cache contains any state from the stream, that state will be used without
fetching more events from the stream.

```ts
const decider = this.resolve(id)
// Note: equivalent to LoadOption.MaxStale(Number.MAX_SAFE_INTEGER)
return decider.transact(decide, LoadOption.AnyCachedValue)
```

## `AssumeEmpty`

Instead of loading the stream, the empty state is supplied to the handler.
Useful to avoid a read roundtrip if you believe there is a good chance that
the value in the cache will be correct (if not, the append will trigger a
reload due to a concurrency conflict during the sync)

```ts
const decider = this.resolve(id)
return decider.transact(decide, LoadOption.AssumeEmpty)
```
