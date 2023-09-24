# Configuring

## Controlling throughput

Propeller has three parameters that work together to control throughput,
`batchSize`, `maxConcurrentStreams` and `maxReadAhead`. Respectively they
control the size of batches read from the source, how many streams can be
concurrently processed, and how many batches can be buffered in memory.

It is generally useful to set `maxReadAhead` to at least `2` to minimise idle
time by allowing the feed to fetch the next batch during the handling of the
streams. The number of events held in memory will be up to `batchSize *
maxReadAhead` (the last batch may be incomplete). As such
`maxReadAhead=3,batchSize=1000` is roughly equivalent to
`maxReadAhead=6,batchSize=500`.

Checkpointing is performed on a per-batch basis so a larger `batchSize` will
mean less frequent checkpointing, and therefore more rework if the process dies.
Checkpoints are sometimes used to report lag from an external observer and a
larger batch size gives less insight into gaps and lags there. Smaller
`batchSize`s on the other hand incur more more round-trips.

The key thing a larger `maxReadAhead` enables is allowing processing to continue
reacting to new events despite a single stream being slow to process.

There's no one-size-fits-all for these parameters, so when setting them you
should consider whether the work being performed by the handler:

- is IO or compute bound
- handles a mix of high/low traffic streams
- can handle sequences of events efficiently relative to processing them
  individually

## Sleeping at the tail

When the tail (end) of a feed has been reached Propeller will sleep for a
configurable interval before reading more. In essence this value controls the
worst-case latency of reaction handling. We've found 1 second to be a sensible
default in most cases but have gone down to 100ms in cases where near real-time
is required. A lower value will mean more frequent round-trips to check for data
and as such should be considered in terms of RUs and DB load.

## Checkpointing

Checkpointing happens asynchronously on a configurable interval. Propeller will
additionally attempt to flush a checkpoint once its AbortSignal is fired. Note
that idempotent handling is a requirement, checkpointing is an optimisation and
your system should behave the same whether it starts from scratch on every start
or at the last stored checkpointed.

This last point is important, in practise it is exceedingly rare for your system
to start up from perfect conditions. You should assume that your program is
starting from a crash state as a rule. This requires a shift in mental-model but
is an overwhelmingly better program design, albeit one that's not widely
encouraged. Every system you rely on that reliably transfers data works like
this.

