---
sidebar_position: 3
---

# PG Projections

As discussed in the previous section, projections are a form of reaction that
can be expressed as a function from `Event` to `Sql[]`. In the previous section
we showed how you could write raw SQL to create a read model but we also supply
a utility library for creating projections.

Read models composed of `Insert`, `Update`, `Delete` and `Upsert` queries where
each stream is represented by a single row in the table can be represented in
the library. By representing the change as objects we're able to intelligently
collapse a changeset to a single change (`Insert a + Update b = Insert (a +
b)`).

The Payer read model from the previous section could be written as:

```ts
import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Pool } from "pg"
import { PayerId } from "../domain/identifiers.js"
import { Payer } from "../domain/index.js"
import { Upsert, Delete, Change, createProjection } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; name: string; email: string }

export const projection = { table: "payer", id: ["id"] }

function changes(stream: string, events: ITimelineEvent<string>[]): Change<Payer>[] {
  const id = PayerId.parse(StreamName.parseId(stream))
  // Payer is a LatestKnownEvent stream so we can construct the current state from the last event
  const event = Payer.codec.tryDecode(events[events.length - 1])
  if (!event) return []
  switch (event.type) {
    case "PayerProfileUpdated":
      const data = event.data
      return [Upsert({ id: id, name: data.name, email: data.email })]
    case "PayerDeleted":
      return [Delete<Payer>({ id: id })]
  }
}

export const createHandler = (pool: Pool) => createProjection(projection, pool, changes)
```

To wire it up we would do

```ts
import "./tracing.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import pg from "pg"
import { Payer } from "../domain/index.js"
import * as PayerReadModel from '../read-models/PayerReadModel.js'

const createPool = (connectionString?: string) =>
  connectionString ? new pg.Pool({ connectionString, max: 10 }) : undefined

const messageDbPool = createPool(process.env.MDB_RO_CONN_STR || process.env.MDB_CONN_STR)!
const pool = createPool(process.env.CP_CONN_STR)!
const checkpointer = new PgCheckpoints(pool)
checkpointer.ensureTable().then(() => console.log("table created"))

const source = MessageDbSource.create({
  pool: messageDbPool, 
  batchSize: 500,
  categories: [Payer.CATEGORY],
  groupName: "PayerReadModel",
  checkpointer,
  handler: PayerReadModel.createHandler(pool),
  tailSleepIntervalMs: 100,
  maxConcurrentStreams: 10,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

source.start(ctrl.signal)
```

