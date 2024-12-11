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
  | { type: "Incremented"; data: { amount: number } }
  | { type: "Snapshotted"; data: { current: number } }

const codec = Codec.json<Event>()
```

We'll handle the Snapshot in our evolution function

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
Snapshot and how to transform the current state into a Snapshot

```ts
const isOrigin = (ev: Event) => ev.type === "Snapshot"
const toSnapshot = (state: State): Event => ({ type: snapshotEventType, data: { current: state } })
```

We can then create the access strategy

```ts
const access = AccessStrategy.Snapshot(isOrigin, toSnapshot)
```

With this in place Equinox will maintain and store a Snapshot event in the tip
document that is guaranteed to always be up to date, and as a result the state
of the Stream can be reconstructed with a single point-read.

## RollingState(toSnapshot)

`RollingState` builds state from events, just like the other modes. The key difference is that it discards the events, only storing the snapshot. This can be
useful for cases where we do not care about the individual events that led up to
a state. Such a mechanism is useful for storing derived data built from things that you already have a way to reason about, e.g. a summary that indexes data from across multiple streams. The main thing to bear in mind is that the total (compressed) size of the state is limited to the DynamoDB Item size limit of 400KiB.

<details>
<summary>Example</summary>

```ts
namespace Events {
  type User = { id: string; name: string; version: number; deleted?: boolean }
  export type Event = { type: "Ingested"; data: { users: Record<string, User> } }
  export const codec = Codec.json<Event>()
}

namespace Fold {
  export type State = Record<string, Events.User>
  export const initial = {}
  export const fold = (state: State, events: Events.Event[]): State => events[0].data
  export const toSnapshot = (state: State): Events.Event => ({
    type: "Ingested",
    data: { users: state.users },
  })
}

namespace Decide {
  const Ingested = (users: Record<string, Events.User>): Events.Event => ({
    type: "Ingested",
    data: { users },
  })
  export const addUser = (user: Events.User) => (state: State) => {
    if (state[id] && state[id].version >= user.version) return []
    if (equals(state[id], user)) return []
    return [Ingested({ ...state, [user.id]: user })]
  }
  export const renameUser = (user: Events.User) => (state: State) => {
    if (state[id] && state[id].version >= user.version) return []
    if (!state[id] || state[id].deleted) throw new Error("User not found")
    if (state[id]?.name === user.name) return []
    return [Ingested({ ...state, [user.id]: user })]
  }
  export const removeUser = (id: string, version: number) => (state: State) => {
    if (state[id] && state[id].version >= version) return []
    if (!state[id] || state[id].deleted) return []
    return [Ingested({ ...state, [id]: { ...state[id], deleted: true } })]
  }
}

export class Service {
  constructor(private readonly resolve: () => Decider<Events.Event, Fold.State>) {}

  addUser(id: string, version: number, name: string) {
    const decider = this.resolve()
    return decider.transact(Decide.addUser({ id, version, name }))
  }

  renameUser(id: string, version: number, name: string) {
    const decider = this.resolve()
    return decider.transact(Decide.renameUser({ id, version, name }))
  }

  removeUser(id: string) {
    const decider = this.resolve()
    return decider.transact(Decide.removeUser({ id, version, name }))
  }

  readUsers() {
    const decider = this.resolve()
    return decider.query((state) => Object.values(state.users))
  }

  static create(context: DynamoStoreContext, cache?: ICachingStrategy) {
    const access = AccessStrategy.RollingState(Fold.toSnapshot)
    // prettier-ignore
    const category = DynamoStoreCategory.create(context, "$UserIndex", Events.codec, Fold.fold, Fold.initial, access, cache)
    const resolve = () => Decider.forStream(category, StreamId.create("0"), null)
    return new Service(resolve)
  }
}
```

</details>
