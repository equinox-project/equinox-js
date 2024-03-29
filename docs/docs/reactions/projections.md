---
sidebar_position: 5
---

# Projections

As discussed, Projections are a form of reaction, and a fairly generalisable one
at that. We recommend structuring projections as a function from `Event` to a
`Changes[]`. In the case of SQL read models the `Changes[]` could be a `Sql[]`.

Projections tend to be necessary when you want to show lists of things, or other
types of views that are not derivable from reading a single stream. Imagine you
have a
[Payer](https://github.com/nordfjord/equinox-js/blob/main/apps/example/src/domain/payer.ts)
category in your system. You might want to display a drop-down of payers when
raising an invoice.

```ts
import * as Payer from '@domain/payer'
import { PayerId } from '@domain/identifiers'

type Sql = {
  text: string
  values: string[]
}

function change(payerId: PayerId, event: Payer.Events.Event): Sql {
  const id = PayerId.toString(payerId)
  switch (event.type) {
    case "PayerProfileUpdated":
      return {
        text: `insert into payer(id, name, email) values ($1, $2, $3)
               on conflict (id) do update set
               name = $2,
               email = $3`,
        values: [payerId, event.data.name, event.data.email],
      }
    case "PayerDeleted":
      return { text: "delete from payer where id = $1", values: [id] }
  }
}

function changes(streamName: string, events: ITimelineEvent[]): Sql[] {
  const payerId = Payer.Stream.tryMatch(streamName)
  if (!payerId) return []
  const changes: Sql[] = []
  for (const event of events) {
    const ev = Payer.codec.decode(event)
    if (!ev) continue
    changes.push(change(payerId, ev))
  }
  return changes
}
```

Having written these function we can now wire them up to a reaction.

```ts
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-source"
import { ITimelineEvent } from '@equinox-js/core'
import { StreamsSink } from '@equinox-js/propeller'
import pg from "pg"

const checkpoints = new PgCheckpoints(new pg.Pool({ connectionString: "..." }), "public")
const pool = new pg.Pool({ connectionString: "..." })

async function handler(streamName: string, events: ITimelineEvent[]) {
  const statements = changes(streamName, events)
  if (statements.length === 0) return
  const client = await pool.connect()
  try {
    // CAUTION: do not lower the isolation level unless you are Kimi Raikkonen
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
    for (const statement of statements) {
      await client.query(statement)
    }
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
  } finally {
    client.release()
  }
}

const sink = StreamsSink.create({
  handler,
  maxConcurrentStreams: 10,
  maxReadAhead: 3,
})

const source = MessageDbSource.create({
  pool,
  batchSize: 500,
  categories: [Payer.CATEGORY],
  groupName: "PayerListModel",
  checkpoints,
  sink,
  tailSleepIntervalMs: 5000,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

source.start(ctrl.signal)
```
