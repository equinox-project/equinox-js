# Access Strategies

The access strategy allows you to opt into custom loading or reloading
algorithms. For almost all categories in almost all most systems, `Unoptimized`
is a good choice; you can always switch later.

# Unoptimized

The first, and likely most used access strategy is the unoptimized one. It'll
not apply any optimised reading logic. When loading a stream for the first time
all of its events will be loaded in batches of `batchSize` (default: `500`).
This turns out to be a sensible default for most aggregates, especially when
used in conjunction with the built-in caching layer.

# LatestKnownEvent(type)

There is a special case of stream whose events are all a "full-replace". An
example could be a customer's contact preferences, or an entity view-data
stream. This access strategy will ensure that you only load at most a single
event when transacting or querying such a stream.

# AdjacentSnapshots(type, toSnapshot, frequency)

Imagine a simple counter
service. It does not have a defined start and end as most processes would and as
such we don't know how large it'll grow over time. In order to ensure the
snappiness of our application we might apply snapshotting to ensure that the
state of the counter can be reconstructed in 2 round-trips instead of N, where N
is the number of events divided by batch size.

In Equinox the snapshot is a member of the Event DU

```ts
type Event =
  | { type: "Increment"; data: { amount: number } }
  | { type: "Snapshot"; data: { current: number } }

const codec = Codec.json<Event>()
```

We'll handle the snapshot in our evolution function

```ts
type State = number
const initial = 0
const evolve = (state: State, event: Event) => {
  switch (event.type) {
    case "Increment":
      return state + event.data.amount
    case "Snapshot":
      return event.data.current
  }
}
const fold = reduce(evolve)
```

In addition to this we need to specify to Equinox which event type represents a
snapshot and how to transform the current state into a snapshot

```ts
const snapshotEventType: Event["type"] = "Snapshot"
const toSnapshot = (state: State): Event => ({ type: snapshotEventType, data: { current: state } })
```

We can then create the access strategy

```ts
const access = AccessStrategy.AdjacentSnapshots(snapshotEventType, toSnapshot)
```

With this in place Equinox will maintain and store a snapshot event in an
adjacent stream `{category}:snapshot-{stream_id}`. When loading the current
state we will first load the latest event from the snapshot stream. The snapshot
event will have the version of the stream it was generated from, this version
will be used to fetch "events since version" from the source stream. In practise
this guarantees that the state of a stream can be reconstructed in 2 round-trips
(aside from some interactions with the cache that can cause it to need an extra
round trip in exceedingly rare cases).


