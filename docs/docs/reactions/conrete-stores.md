---
sidebar_position: 1
---

# Concrete stores

Equinox stores expose a `source` package to wire reactions up. In the [previous
section](/docs/reactions) we created a `handler`. Source packages interact with
`Sink`s rather than handler functions so we must first construct a sink from
the handler.

```ts
import { StreamsSink } from "@equinox-js/propeller"
const sink = StreamsSink.create({
  handler,
  // How many streams are we OK to process concurrently?
  maxConcurrentStreams: 10,
  // How many batches can be pre-loaded beyond what's been completed 
  // (checkpointing is always sequential in order of age)
  maxReadAhead: 3,
})
```

## MessageDB

```ts
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-source"
import pg from "pg"

const checkpoints = new PgCheckpoints(new pg.Pool({ connectionString: "..." }), "public")
await checkpoints.ensureTable() // creates the checkpoints table if it doesn't exist

const pool = new pg.Pool({ connectionString: "..." })

const source = MessageDbSource.create({
  // the database pool to use
  pool,
  // under the hood the source polls for baches of events, this controls the
  // batch size
  batchSize: 500,
  // list of categories to subscribe to.
  categories: [Message.CATEGORY],
  // Consumer group name (used for checkpointing and tracing)
  groupName: "MessageNotifications",
  // the checkpointer maintains checkpoints on per category per group basis
  checkpoints,
  // Once we've processed all events in the store, how long should we wait
  // before requesting a new batch? In this case we want close to real time so
  // will poll after 100ms
  tailSleepIntervalMs: 100,
  sink,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

await source.start(ctrl.signal)
```

## DynamoStore

```ts
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoStoreSource, DynamoCheckpoints, LoadMode } from "@equinox-js/dynamo-store-source"
// prettier-ignore
import { DynamoStoreClient, DynamoStoreContext, QueryOptions, TipOptions } from "@equinox-js/dynamo-store"

const ddb = new DynamoDB()

// This context will be used to read the index
const indexContext = new DynamoStoreContext({
  client: new DynamoStoreClient(ddb),
  tableName: process.env.INDEX_TABLE_NAME || "events_index",
  tip: TipOptions.create({}),
  query: QueryOptions.create({}),
})

// This context will be used to hydrate event bodies
const eventsContext = new DynamoStoreContext({
  client: new DynamoStoreClient(ddb),
  tableName: process.env.TABLE_NAME || "events",
  tip: TipOptions.create({}),
  query: QueryOptions.create({}),
})

const checkpoints = DynamoCheckpoints.create(
  context,
  config.cache,
  // store an event at most every 5 minutes
  // the state will always be updated, but an event does not need to be written
  // every time
  300,
)

const source = DynamoStoreSource.create({
  // A dynamo store context wired up to the index table
  context: indexContext,
  // While each epoch can contain up to 1,000,000 events that'd be a poor batch
  // size for checkpointing purposes. Instead the source splits the epoch into
  // batches of this size to facilitate checkpointing
  batchSizeCutoff: 500,
  // list of categories to subscribe to.
  categories: [Message.CATEGORY],
  // Consumer group name (used for checkpointing and tracing)
  groupName: "MessageNotifications",
  // the checkpointer maintains checkpoints on per category per group basis
  checkpoints,
  // Once we've processed all events in the store, how long should we wait before requesting a new batch?
  // In this case we want close to real time so will poll after 100ms
  tailSleepIntervalMs: 1000,
  maxReadAhead: 3,
  // The index contains the stream name, the type of the event, and the index of
  // the event in the stream. If this is all the information necessary for
  // processing we can use `LoadMode.IndexOnly()`. In this case the data is
  // necessary so we use `WithData` with a load concurrency of 10. The load
  // concurrency means we'll be making at most 10 concurrent stream load
  // requests to Dynamo
  mode: LoadMode.WithData(10, eventsContext),
  sink,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

await source.start(ctrl.signal)
```

