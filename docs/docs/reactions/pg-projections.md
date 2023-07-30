---
sidebar_position: 3
---

# PG Projections

We provide `@equinox-js/projection-pg` as a simple way to create SQL
read models. It allows you to define your `Changes` function without
writing raw SQL. We could write the payer projection in the previous section as:

```ts
import { Change, Upsert, Delete, Projection } from "@equinox-js/projection-pg"
import { Pool } from "pg"
type Payer = { id: PayerId; name: string; email: string }
type Id = "id"
type PayerChange = Change<Payer, Id>

function changes(streamName: string, events: ITimelineEvent<string>[]): Sql[] {
  const payerId = PayerId.parse(StreamName.parseId(streamName))
  // Payer is a LatestKnownEvent stream so we only need the last event
  const event = Payer.codec.tryDecode(events[events.length - 1])
  if (!event) return []
  switch (event.type) {
    case "PayerProfileUpdated":
      return [Upsert({ id, name: event.data.name, email: event.data.email })]
    case "PayerDeleted":
      return [Delete({ id })]
  }
}

export const createHandler = (pool: Pool) => {
  const viewData = new ViewData<Payer, Id>("payer", ["id"])
  return viewData.createHandler(pool, changes)
}
```

To wire it up we would do

```ts
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import { ViewData } from "@equinox-js/view-data-pg"
import PayerViewModel from "./view-models/payer"
import pg from "pg"

const pool = new pg.Pool({ connectionString: "..." })
const checkpointer = new PgCheckpoints(pool, "public")
const messageDbPool = new pg.Pool({ connectionString: "..." })

const source = MessageDbSource.create({
  pool: messageDbPool,
  batchSize: 500,
  categories: [Payer.CATEGORY],
  groupName: "PayerListModel",
  checkpointer,
  handler: PayerViewModel.createHandler(pool),
  tailSleepIntervalMs: 5000,
  maxConcurrentStreams: 10,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

await source.start(ctrl.signal)
```

## Extended example

```ts
import { Change, Insert, Upsert, Delete, Projection } from "@equinox-js/projection-pg"
import { Pool } from "pg"
type Appointment = {
  id: AppointmentId
  title: string
  start: Date
  duration_ms: number
  is_cancelled: boolean
}
type Id = "id"
type AppointmentChange = Change<Appointment, Id>

function changes(streamName: string, events: ITimelineEvent<string>[]): Sql[] {
  const id = AppointmentId.parse(StreamName.parseId(streamName))
  // Payer is a LatestKnownEvent stream so we only need the last event
  const decodedEvents = keepMap(events, Appointment.codec.tryDecode)
  const result: AppointmentChange[] = []
  for (const event of decodedEvents) {
    const data = event.data
    switch (event.type) {
      case "AppointmentScheduled":
        result.push(
          Insert({
            id,
            title: data.title,
            start: data.start,
            duration_ms: data.duration_ms,
            is_cancelled: false,
          }),
        )
      case "AppointmentRescheduled":
        result.push(Update({ id, start: data.start }))
      case "AppointmentCancelled":
        result.push(Update({ id, is_cancelled: true }))
    }
  }
  return result
}

export const createHandler = (pool: Pool) => {
  const viewData = new ViewData<Appointment, Id>("appointment", ["id"])
  return viewData.createHandler(pool, changes)
}
```

The library will automatically fold the changes into the smallest changeset
required. So if you have an `insert + update + update` it'll be a single
`insert`. An `insert + update + delete` will be a no-op


