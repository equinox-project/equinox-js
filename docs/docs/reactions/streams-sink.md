---
sidebar_position: 4
---

# StreamsSink

The `StreamsSink` is at the heart of `@equinox-js/propeller`'s reaction handling
paradigm. It is designed to process streams of events concurrently while
managing event order, and concurrency limits.

## Key facts

- Receives batches of events from the underlying store source
- Fetching of new batches is done concurrently with the handling of the current
  ones
- Merges events from different batches into a single list per stream
- Checkpointing happens out of bound on an interval
- When a batch is completed its checkpoint is queued for writing
- Ensures that for a given stream only one handler is active at any given time

## Notifying propeller of partial processing

The handler you pass to `StreamsSink` may optionally return a `StreamResult`.
This result can indicate how far the stream in question has been processed.

### `StreamResult.AllProcessed` (default)

Indicates all events supplied were processed. Write position will move beyond
the last event supplied.

### `StreamResult.NoneProcessed`

Indicates no events were processed. On the next call your handler will be
supplied the same events in addition to any that arrived in the interim.

### `StreamResult.PartiallyProcessed(count)`

Indicates that a subset of the events were processed. Write position will
advance to `count` fewer events

### `StreamResult.OverrideNextIndex(index)`

Indicates that the stream is processed up to the supplied version. Typically
used when the handler reads the supplied stream from the store. In this case
eventual consistency from read replicas, or in general from cloud native
document stores, means it might not see all the events. Additionally, in case of
replay, it might see events beyond the supplied span. In these cases
`OverrideNextIndex` can be used to let propeller know that the handler should
not be called again until the event indicated by the `index` appears. Propeller
will throw away events before the index.
