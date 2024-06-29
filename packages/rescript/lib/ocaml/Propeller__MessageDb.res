module Source = {
  type options = {
    /** The database pool to use to read messages from the category */
    pool: Postgres.t,
    /** The categories to read from */
    categories: array<string>,
    /**
     * The maximum number of messages to read from the category at a time
     * @default 500
     */
    batchSize?: int,
    /** The name of the consumer group to use for checkpointing */
    groupName: string,
    /** The checkpointer to use for checkpointing */
    checkpoints: Propeller__Checkpoints.t,
    /** The sink to pump messages into */
    sink: Propeller__Sink.t,
    /** emit a metric span every statsIntervalMs */
    statsIntervalMs?: int,
    /** sleep time in ms between reads when at the end of the category */
    tailSleepIntervalMs: int,
    /** sleep time in ms between checkpoint commits */
    checkpointIntervalMs?: int,
    /** When using consumer groups: the index of the consumer. 0 <= i <= consumerGroupSize
     * each consumer in the group maintains their own checkpoint */
    consumerGroupMember?: int,
    /** The number of group consumers you have deployed */
    consumerGroupSize?: int,
  }

  type t

  @send
  external start: (t, AbortSignal.t) => Js.Promise.t<unit> = "start"

  @module("@equinox-js/message-db-source") @scope("MessageDbSource")
  external create: options => t = "create"
}
