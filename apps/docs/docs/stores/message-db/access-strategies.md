# Access Strategies


# Unoptimized

The first, and likely most used access strategy is the unoptimized one. It'll not apply any optimised reading logic.
When loading a stream for the first time all of its events will be loaded in batches of `batchSize` (default: `500`).
This turns out to be a sensible default for most aggregates, especially when used in conjunction with the
built-in caching layer.

# LatestKnownEvent(type)

There is a special case of stream whose events are all a "full-replace". An example could be a customer's contact
preferences, or an entity view-data stream. This access strategy will ensure that you only load at most a single event
when transacting or querying such a stream.

# AdjacentSnapshots(type, toSnapshot)

Generates and stores a snapshot event in an adjacent `{category}:snapshot-{stream_id}` stream.
The generation happens every `batchSize`events.
In practise, this means the state of the stream can be reconstructed with exactly 2 round-trips to the database.
The first round-trip fetches the most recent event of type `type` from the snapshot stream.
The second round-trip fetches `batchSize` events from the position of the snapshot
The `toSnapshot` function is used to generate the event to store in the snapshot stream.
It should return the event case whose name matches `type`
