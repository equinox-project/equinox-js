---
sidebar_position: 4
---

# Propeller

Propeller is EquinoxJS's "[propulsion](https://github.com/jet/propulsion)
lite". It's a set of abstractions for building reactive event processing
pipelines catering specifically for event sourced reactions from Equinox's
stores.

## StreamsSink

The `StreamsSink` receives batches of events from a source and intelligently
manages handling them.

- **Stream management**: maintains an ordered queue of incoming streams, ensuring
  that events are processed in an orderly manner.
- **Concurrency control**: To ensure optimal performance, StreamsSink restricts the
  number of streams and event batches that can be processed at once. It
  efficiently handles the inflow of new event batches, ensuring the system
  doesn't get overwhelmed.
- **Batch merging**: intelligently merges new events with existing streams. This
  allows for a more streamlined event processing, ensuring that events from
  multiple batches related to the same stream are handled together.

## TailingFeedSource

`TailingFeedSource` continuously crawls a feed, submitting batches of events to
a `Sink`.

- **Crawling**: Continuously crawls a given feed. It pauses momentarily between crawls once
  it's reached the tail of the feed.
- **Checkpointing**: Regularly updates the checkpoint position to match the latest
  processed batch. Flushes the checkpoint when interrupted to minimise reduntant
  processing on start up.
