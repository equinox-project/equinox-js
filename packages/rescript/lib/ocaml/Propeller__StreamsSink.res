open Equinox__Types

type options = {
  /** The handler to call for each batch of stream messages */
  handler: (Equinox__StreamName.t, array<TimelineEvent.t<string>>) => promise<unit>,
  /** The maximum number of streams that can be processing concurrently
     * Note: each stream can have at most 1 handler active */
  maxConcurrentStreams: int,
  /** The number of batches the source can read ahead the currently processing batch */
  maxReadAhead: int,
}

@module("@equinox-js/propeller") @scope("StreamsSink")
external create: options => Propeller__Sink.t = "create"
