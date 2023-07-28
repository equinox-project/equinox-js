import { MessageDbCategoryReader } from "./MessageDbClient.js"
import { ICheckpointer } from "./Checkpoints.js"
import { ITimelineEvent, Tags } from "@equinox-js/core"
import { Pool } from "pg"
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api"
import { sleep } from "./Sleep.js"
import pLimit from "p-limit"

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
  /** The number of milliseconds to sleep between tail reads */
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

const tracer = trace.getTracer("@equinox-js/message-db-consumer")
const defaultBatchSize = 500

export class MessageDbSource {
  private readonly runHandler: (fn: () => Promise<void>) => Promise<void>
  constructor(
    private readonly client: MessageDbCategoryReader,
    private readonly options: Options,
  ) {
    this.runHandler = pLimit(options.maxConcurrentStreams)
  }

  private runHandlerWithTrace(
    category: string,
    streamName: string,
    events: ITimelineEvent<string>[],
    handler: () => Promise<void>,
  ) {
    const firstEventTimeStamp = events[events.length - 1]!.time.getTime()
    return tracer.startActiveSpan(
      `${category} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          [Tags.category]: category,
          [Tags.stream_name]: streamName,
          "eqx.consumer_group": this.options.groupName,
          "eqx.tail_sleep_interval_ms": this.options.tailSleepIntervalMs,
          "eqx.max_concurrent_streams": this.options.maxConcurrentStreams,
          [Tags.batch_size]: this.options.batchSize ?? defaultBatchSize,
          "eqx.stream_version": Number(events[events.length - 1]!.index),
          [Tags.loaded_count]: events.length,
        },
      },
      (span) =>
        handler()
          .catch((err) => {
            span.recordException(err)
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
            throw err
          })
          .finally(() => {
            span.setAttribute("eqx.lead_time_ms", Date.now() - firstEventTimeStamp)
            span.end()
          }),
    )
  }

  private async pumpCategory(signal: AbortSignal, category: string) {
    const {
      handler,
      groupName,
      checkpointer,
      tailSleepIntervalMs,
      batchSize = defaultBatchSize,
      condition,
      consumerGroupMember,
      consumerGroupSize,
    } = this.options
    const readBatch = (fromPositionInclusive: bigint) =>
      this.client.readCategoryMessages({
        category,
        fromPositionInclusive,
        batchSize,
        condition,
        consumerGroupSize,
        consumerGroupMember,
      })
    const checkpointGroupName =
      consumerGroupMember != null ? `${groupName}-${consumerGroupMember}` : groupName
    let position = await checkpointer.load(checkpointGroupName, category)
    while (!signal.aborted) {
      const batch = await readBatch(position)
      if (signal.aborted) return
      const byStreamName = new Map<string, ITimelineEvent<string>[]>()
      for (let i = 0; i < batch.messages.length; ++i) {
        const [streamName, msg] = batch.messages[i]
        if (!byStreamName.has(streamName)) byStreamName.set(streamName, [])
        byStreamName.get(streamName)!.push(msg)
      }

      const promises = []

      for (const [stream, events] of byStreamName.entries()) {
        promises.push(
          this.runHandler(() =>
            this.runHandlerWithTrace(category, stream, events, () => handler(stream, events)),
          ),
        )
      }
      await Promise.all(promises)
      if (batch.checkpoint != position) {
        await checkpointer.commit(checkpointGroupName, category, batch.checkpoint)
        position = batch.checkpoint
      }
      if (batch.isTail) await sleep(tailSleepIntervalMs, signal).catch(() => {})
    }
  }

  start(signal: AbortSignal) {
    return Promise.all(
      this.options.categories.map((category) => this.pumpCategory(signal, category)),
    )
  }

  static create(options: Options & { pool: Pool }) {
    const client = new MessageDbCategoryReader(options.pool)
    return new MessageDbSource(client, options)
  }
}
