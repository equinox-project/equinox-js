# Access Strategies

The access strategy allows you to opt into custom loading or reloading
algorithms. For most systems, `Unoptimized` is a safe default; you can always
switch later.


# Unoptimized

The first, and likely most used access strategy is the unoptimized one. It'll
not apply any optimized reading logic. Loading uses a `Query` that loads
batches backwards from the tip. This turns out to be a sensible default for
most aggregates, especially when used in conjunction with the built-in caching
layer.

# LatestKnownEvent

There is a special case of stream whose events are all a "full-replace". An
example could be a customer's contact preferences, or an entity view-data
stream. This access strategy will ensure that you only load at most a single
event when transacting or querying such a stream.

# Snapshot(isOrigin, toSnapshot)

Imagine a simple counter service. It does not have a defined start and end as
most processes would and as such we don't know how large it'll grow over time.
In order to ensure the snappiness of our application we might apply
snapshotting to ensure that the state of the counter can be reconstructed in
at-most 1 round-trip.

In Equinox the Snapshot is a member of the Event DU

```ts
type Event =
  | { type: "Increment", data: { amount: number } }
  | { type: "Snapshot", data: { current: number } }

const codec = Codec.json<Event>()
```

We'll handle the Snapshot in our evolution function

```ts
type State = number
const initial = 0
const evolve = (state: State, event: Event) => {
  switch (event.type) {
    case "Increment": return state + event.data.amount
    case "Snapshot": return event.data.current
  }
}
const fold = reduce(evolve)
```

In addition to this we need to specify to Equinox which event type represents a
Snapshot and how to transform the current state into a Snapshot

```ts
const isOrigin = (ev: Event) => ev.type === "Snapshot"
const toSnapshot = (state: State): Event => 
  ({ type: snapshotEventType, data: { current: state } })
```

We can then create the access strategy
```ts
const access = AccessStrategy.Snapshot(isOrigin, toSnapshot)
```

With this in place Equinox will maintain and store a Snapshot event in the tip
document that is guaranteed to always be up to date, and as a result the state
of the Stream can be reconstructed with a single point-read.

