# @equinox-js/message-db-consumer

The `@equinox-js/message-db-consumer` library provides a convenient API for consuming events from a MessageDB instance.
It's designed to be used with equinox-js projects but can be used in any node application.

## Features

- High throughput message consumption
- Integrated checkpointer for resuming from last processed event
- Configurable batch sizes for event fetching
- Support for handling multiple concurrent streams 
- Automatic reconnection and backoff

```ts
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import pg from "pg"

const checkpointer = new PgCheckpoints(new pg.Pool({ connectionString: "..." }), "public")
await checkpointer.ensureTable() // creates the checkpoints table if it doesn't exist

const pool = new pg.Pool({ connectionString: "..." })

const source = MessageDbSource.create({
  pool, // the database pool to use
  batchSize: 500, // under the hood the source polls for baches of events, this controls the batch size
  categories: ["Invoice"], // list of categories to subscribe to.
  groupName: "InvoiceAutoEmailer", // Consumer group name (used for checkpointing and tracing)
  checkpointer, // the checkpointer maintains checkpoints on per category per group basis
  // Your handler will receive a list of events for a given stream
  handler: async (streamName, events) => console.log("received", events.length, "events for", streamName),
  tailSleepIntervalMs: 100, // If we reach the end of the event store, how long should we wait before requesting a new batch?
  maxConcurrentStreams: 10, // How many streams are we OK to process concurrently?
})

const ctrl = new AbortController()
source.start(ctrl.signal)
```
