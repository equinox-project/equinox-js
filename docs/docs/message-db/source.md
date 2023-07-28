# Source

The MessageDB source continuously fetches batches of messages and dispatches
them to a supplied handler. It supports reading from multiple categories at a
time, server side filtering, and splitting processing into multiple parallel
consumer groups.

## Options

When creating a MessageDB source via `MessageDbSource.create` the following
options can be supplied

```ts
interface CreateOptions {
  /** The database pool to use to read messages from the category */
  pool: Pool
  /** The categories to read from */
  categories: string[]
  /** The maximum number of messages to read from the category at a time
   * @default 500
   */
  batchSize?: number
  /** The name of the consumer group to use for checkpointing */
  groupName: string
  /** The checkpointer to use for checkpointing */
  checkpointer: ICheckpointer
  /** The handler to call for each batch of stream messages */
  handler: (streamName: string, events: ITimelineEvent<string>[]) => Promise<void>
  /** sleep time in ms between reads when at the end of the category */
  tailSleepIntervalMs: number
  /** The maximum number of concurrent streams to process, enforced via p-limit */
  maxConcurrentStreams: number
  /** Apply a server side filter condition to the reading of messages
   * NOTE: you will need to set the `message_store.sql_condition` setting to `"on"` to use this feature
   */
  condition?: string
  /** When using consumer groups: the index of the consumer. 0 <= i <= consumerGroupSize
   * each consumer in the group maintains their own checkpoint */
  consumerGroupMember?: number
  /** The number of group consumers you have deployed */
  consumerGroupSize?: number
}
type Options = Omit<CreateOptions, "pool">

```

## Consumer groups

When using the consumer group functionality two things deviate from normal
operation.

1. The checkpointer will checkpoint to `{groupName}-{member}`
2. MessageDB will filter messages based on a hash of the stream id

This means that each consumer in the group maintains a distinct checkpoint and
is therefore not easily autoscaled. In order to expand or contract a consumer
group you will need to wipe the checkpoints and have all of the consumers in the
group start from the current lowest checkpoint.

Using a hash of the ID guarantees that all messages for a particular entity will
be handled by the same consumer.
