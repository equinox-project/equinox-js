# Inline Projections

Equinox's MessageDb store is designed to allow updating a read model in the
same transaction as appending events. That is, it ensures that either both the
events are appended **and** the read model is updated, or neither. While not
generally advisable it can simplify the infrastructure of running an event
sourced application significantly. Under normal circumstances each of your
read-models would be polling the store for events in order to apply updates.
This causes some pressure on the system that, while easily relieved with
read-replicas, can be a hassle to deal with and increases infrastructure costs.
In contrast, immediately consistent read models will trade off some write
performance to entirely circumvent the need for a read-model consumer.

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

Setting up immediately consistent read models requires some extra work on top of
the regular message-db install. The read model needs to be in the same database
as your events and you must use a role that has privileges on the
`message_store` schema as well as your projection schema.

```sql
create role my_user with login;
alter role my_user set search_path to message_store, public;
grant message_store to my_user;
```

Then when creating your category you supply the optional `onSync` function.

```ts
import { MessageDbCategory, MessageDbContext, AccessStrategy } from "@equinox-js/message-db"
import { Decider, ICachingStrategy, StreamId } from "@equinox-js/core"
import { Client } from "pg"

async function onSync(conn: Client, streamId: StreamId, state: Fold.State) {
  await conn.query(...)
}

export class Service {
  static create(ctx: MessageDbContext, caching: ICachingStrategy) {
    const access = AccessStrategy.Unoptimized()
    const category = MessageDbCategory.create(ctx, name, codec, fold, initial, caching, access, onSync)
    const resolve = (...) => Decider.forStream(category, streamId(...), null)
    return new Service(resolve)
  }
}
```

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
export const onSync = (client: Client, streamId: StreamId, state: State) =>
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
    const access = AccessStrategy.LatestKnownEvent()
    return MessageDbCategory.create(..., access, caching, PayerReadModel.onSync)
  }
}
```

</details>
