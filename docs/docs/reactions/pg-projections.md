---
sidebar_position: 6
---

# PG Projections

In the previous section, we explored the creation of read models via raw SQL
queries, a method which, while effective, can be complicated and error-prone.  
`@equinox-js/projection-pg` provides a higher level abstraction for creating
event sourced projections. With it you can express your projections as a
function `Event -> Change[]` where `Change` is an `Insert`, `Update`, `Delete`
or `Upsert`. By representing changes this way we can intelligently
collapse changesets into a single change, this is because in FP terms the change
is a semigroup.

The Payer read model from the previous section could be written as:

```ts
import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Pool } from "pg"
import { PayerId } from "@domain/identifiers"
import * as Payer from "@domain/payer"
import { forEntity, Change, createProjection } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; name: string; email: string }

const { Delete, Upsert } = forEntity<Payer, "id">()

export const projection = { table: "payer", id: ["id"] }

function changes(stream: string, events: ITimelineEvent[]): Change[] {
  const id = PayerId.parse(StreamName.parseId(stream))
  const event = Payer.codec.decode(events[events.length - 1])
  if (!event) return []
  switch (event.type) {
    case "PayerProfileUpdated":
      const data = event.data
      return [Upsert({ id: id, name: data.name, email: data.email })]
    case "PayerDeleted":
      return [Delete({ id: id })]
  }
}

export const createHandler = (pool: Pool) => createProjection(projection, pool, changes)
```

It's worth calling out the `forEntity` helper there. It takes two type
parameters, the entity and the keys representing the id. If the payer projection
was in a multi tenant system we might've represented it as
`forEntity<Payer, 'id' | 'tenant_id'>`. The resulting `Insert`, `Update`,
`Delete`, and `Upsert` functions will allow the compiler to yell at you if you
forget to supply part of the ID to `Delete` or `Update`.

To wire it up we would do

```ts
import "./tracing.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-source"
import pg from "pg"
import { Payer } from "../domain/index.js"
import * as PayerReadModel from "../read-models/PayerReadModel.js"

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

# Version numbers

It's possible to configure the projection with a version number column. In most
cases you can use the stream version as the version seamlessly. As an example
let's imagine an Appointment model.

```ts
type AppointmentModel = {
  id: string
  title: string
  start: Date
  duration_ms: number
  is_cancelled: boolean
  version: bigint
}

const projection = {
  schema: "view_models",
  table: "appointment",
  id: ["id"],
  version: "version",
}

const { Insert, Update } = forEntity<AppointmentModel, "id" | "version">()

function change(id: AppointmentId, version: bigint, event: Appointment.Event) {
  switch (event.type) {
    case "AppointmentScheduled":
      return Insert({
        id,
        version,
        title: event.data.title,
        start: event.data.start,
        duration_ms: event.data.duration_ms,
        is_cancelled: false,
      })
    case "AppointmentRescheduled":
      return Update({ id, version, start: event.data.start })
    case "AppointmentCancelled":
      return Update({ id, version, is_cancelled: true })
  }
}

function changes(streamName: string, events: ITimelineEvent[]): Change[] {
  const id = AppointmentId.parse(StreamName.parseId(streamName))
  const version = events[events.length - 1].index
  return keepMap(events, Appointment.codec.decode).map((ev) => change(id, version, ev))
}

export const createHandler = (pool: Pool) => createProjection(projection, pool, changes)
```

The second type argument to `forEntity` represents the "required keys." That is,
for actions that don't contain the full entity, like Deletes and Updates, these
keys MUST be provided. This helps us catch some issues in the type system rather
than at runtime.

When `version` is provided the behaviour of the projection changes slightly

- Insert: No change
- Update: adds `where version < $version`
- Delete: adds `where version < $version`
- Upsert: add `where version < $version` to the conflict branch of the query
