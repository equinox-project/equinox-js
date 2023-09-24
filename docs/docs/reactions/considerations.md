---
sidebar_position: 3
---

# Considerations

In the previous section we learned about reactions but we omitted some important
concepts.

## Order of Events

While the order of events within a stream is guaranteed, the order of events
across different streams is not. This is something you need to be aware of when
designing your reactions.

In the rare case you absolutely need ordering across streams we recommend
creating a third stream whose purpose is to provide a repeatably read order.
This is an easily abstractable problem. Take a look at
[ntl/aggregate-streams](https://github.com/ntl/aggregate-streams) for
inspiration.

## Idempotency

An idempotent action is one which can be repeated multiple times without
changing the outcome. Once you become aware of the concept you'll see it in your
daily life all the time. Think of the last time you crossed the street. There's
usually a crosswalk with a beg-button. If you press the beg-button once it'll
light up to let you know your turn will come. But then, no matter how many times
you furiously press the beg-button after that it'll stay in the same state. This
is idempotence.

Equinox provides at-least-once delivery semantics (there is no such thing as
[exactly-once
delivery](https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/)). As
such your handler can receive the same event multiple times. You should ensure
that your reaction is resilient to this, in other words you should ensure that
your reaction is idempotent.

In the previous section's example, the notifier service checks if the message
recipients have been notified before attempting to send notifications. This is
to avoid sending duplicate notifications if the operation was previously
successful. Idempotent reactions makes it easier to manage state and ensure
consistent results.

## Checkpointing

The checkpointer is a crucial component that ensures the state of the event
processing is preserved. It maintains checkpoints on a per category per group
basis, recording the progress of event processing. This enables the system to
resume from where it left off in case of a restart or a failure.

## Polling and Batches

Under the hood the source polls for batches of events. Checkpointing happens on
a per-batch basis. A simplified version of the subscriber would look like this:

```ts
async function start() {
  let checkpoint = await checkpointer.load()
  while (true) {
    const batch = await getNextBatch(checkpoint)
    for (const [stream, events] of groupByStream(batch.messages)) {
      await handle(stream, events)
    }
    if (batch.checkpoint > checkpoint) await checkpointer.save(batch.checkpoint)
    if (batch.isTail) await sleep(tailSleepIntervalMs)
  }
}
```

This should give you a rough idea of how the thing works. On top of this
simplified version we add bounded concurrent handling, cancellation, and
tracing.

The properties of the subscriber can be altered to fit your needs as well. The
tail sleep interval controls how long to wait between polls when we're at the
end of the store, use a lower value of you need to be closer to real time. The
general advice is to tune it to roughly the throughput of the category such that
an empty batch is a rare occurrence. Max concurrent streams controls how many
streams you can have in flight at any given moment. As an example, if your
reaction involves a database you might use the same value for the database pool
size and the maximum concurrency.

## Shutdown

When running your application, it's good practise to listen for system signals
like `SIGINT` and `SIGTERM` to gracefully stop the processing. If your source
fails, you should restart it to ensure that your reactions continue processing
events.
