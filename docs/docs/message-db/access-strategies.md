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

# AdjacentProjection(project, ?access)

`AdjacentProjection` is designed to allow updating a read model in the same
transaction as appending events. That is, it ensures that either both the events
are appended **and** the read model is updated, or neither. While not generally
advisable it can simplify the infrastructure of running an event sourced
application significantly. Under normal circumstances each of your read-models
would be polling the store for events in order to apply updates. This causes
some pressure on the system that, while easily relieved with read-replicas, can
be a hassle to deal with and increases infrastructure costs. In contrast, the
`AdjacentProjection` strategy will trade off some write performance to entirely
circumvent the need for a read-model consumer.

### When to avoid

You should avoid this strategy when:

- Your clients can handle a few seconds of eventual consistency
- You're already using read-replicas (because read-replicas are eventually
  consistent already 😉)
- A row in the projected table depends on anything more than the state of a
  single stream

### Challenges

The big challenge with this strategy is what happens when you have a bug in the
projection. This can go one of two ways:

1. The bug means you have bad data in the projection
2. The bug means you cannot append otherwise valid events to streams

Without this strategy the second simply cannot happen, and the first is readily
dealt with by fixing the bug and replaying the model. When this strategy is in
play however, the second is unfixable, you will have lost user intent, blocked
updates, and most likely won't have any record of it in the system. If you're
lucky you'll have caught it with observability tooling. The former now needs a
more involved intervention as well. Instead of replaying the projection you'll
need to write a script that traverses the category and updates the projection in
place for every affected stream. 

### Setting up

This access strategy doesn't quite work out of the box. You'll need to have your
read-model in the same database as your events and connect with a a user that
has access to both your read-model schema and the message-store schema.

### Examples

See [the example app](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/payer.ts) for a full example

<details>
  <title>Example with `pg-projections`</title>

You'll first create your projection

```ts
// PayerReadModel.ts
import { StreamId } from "@equinox-js/core"
import { Pool, Client } from "pg"
import { PayerId } from "../domain/identifiers.js"
import { Payer } from "../domain/index.js"
import { forEntity, Change, createHandler } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; name: string; email: string }

const { Delete, Upsert } = forEntity<Payer, "id">()

export const projection = { table: "payer", id: ["id"] }

type State = { name: string; email: string } | null

function changes(streamId: StreamId, state: State): Change[] {
  const id = Payer.Stream.decodeId(streamId)
  if (!id) return []
  if (!state) return [Delete({ id })]
  return [Upsert({ id, name: state.name, email: state.email })]
}

const handler = createHandler(projection)
export const project = (client: Client, streamId: StreamId, state: State) =>
  handler(client, changes(streamId, state))
```

And then you'd wire up the access strategy when creating the service

```ts
import { AccessStrategy, MessageDbContext, MessageDbCategory } from "@equinox-js/message-db"
import { ICache, CachingStrategy } from "@equinox-js/core"
import * as PayerReadModel from "../read-models/PayerReadModel.js"

class Service {
  // ...

  static create(ctx: MessageDbContext, cache: ICache) {
    const caching = CachingStrategy.Cache(cache)
    const access = AccessStrategy.AdjacentProjection(PayerReadModel.project)
    return MessageDbCategory.create(..., access, caching)
  }
}
```
