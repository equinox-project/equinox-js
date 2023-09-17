import { MessageDbCategoryReader } from "./MessageDbClient.js"
import { ITimelineEvent, StreamName, Tags } from "@equinox-js/core"
import { Pool } from "pg"
import { ICheckpoints, Sink, StreamsSink, TailingFeedSource } from "@equinox-js/propeller"

interface CreateOptions {
  /** The database pool to use to read messages from the category */
  pool: Pool
  /** The categories to read from */
  categories: string[]
  /**
   * The maximum number of messages to read from the category at a time
   * @default 500
   */
  batchSize?: number
  /** The name of the consumer group to use for checkpointing */
  groupName: string
  /** The checkpointer to use for checkpointing */
  checkpoints: ICheckpoints
  /** The handler to call for each batch of stream messages */
  handler: (streamName: StreamName, events: ITimelineEvent[]) => Promise<void>
  /** sleep time in ms between reads when at the end of the category */
  tailSleepIntervalMs: number
  /** The maximum number of concurrent streams to process, enforced via p-limit */
  maxConcurrentStreams: number
  /** When using consumer groups: the index of the consumer. 0 <= i <= consumerGroupSize
   * each consumer in the group maintains their own checkpoint */
  consumerGroupMember?: number
  /** The number of group consumers you have deployed */
  consumerGroupSize?: number
}
type Options = Omit<CreateOptions, "pool">

const defaultBatchSize = 500

namespace Impl {
  type Params = {
    client: MessageDbCategoryReader
    batchSize: number
  }
  export const crawl = (
    client: MessageDbCategoryReader,
    batchSize: number,
    consumerGroupMember?: number,
    consumerGroupSize?: number,
  ) =>
    async function* crawlCategory(trancheId: string, position: bigint, signal: AbortSignal) {
      while (!signal.aborted) {
        const batch = await client.readCategoryMessages({
          category: trancheId,
          fromPositionInclusive: position,
          batchSize,
          consumerGroupSize,
          consumerGroupMember,
        })
        yield batch
      }
    }
}

export class MessageDbSource {
  private inner: TailingFeedSource
  constructor(
    client: MessageDbCategoryReader,
    batchSize: number,
    tailSleepIntervalMs: number,
    groupName: string,
    groupMember: number | undefined,
    groupSize: number | undefined,
    checkpoints: ICheckpoints,
    sink: Sink,
    private readonly categories: string[],
  ) {
    const crawl = Impl.crawl(client, batchSize, groupMember, groupSize)
    this.inner = new TailingFeedSource(
      "MessageDb",
      tailSleepIntervalMs,
      groupName,
      checkpoints,
      sink,
      crawl,
    )
  }

  async start(signal: AbortSignal) {
    const all: Promise<void>[] = []
    for (const category of this.categories) {
      all.push(this.inner.start(category, signal))
    }
    await Promise.all(all)
  }

  static create(options: Options & { pool: Pool }) {
    const client = new MessageDbCategoryReader(options.pool)
    const sink = new StreamsSink(options.handler, options.maxConcurrentStreams, {
      "eqx.consumer_group": options.groupName,
      "eqx.tail_sleep_interval_ms": options.tailSleepIntervalMs,
      "eqx.max_concurrent_streams": options.maxConcurrentStreams,
      "eqx.source": "MessageDb",
      [Tags.batch_size]: options.batchSize ?? defaultBatchSize,
    })
    return new MessageDbSource(
      client,
      options.batchSize ?? 500,
      options.tailSleepIntervalMs,
      options.groupName,
      options.consumerGroupMember,
      options.consumerGroupSize,
      options.checkpoints,
      sink,
      options.categories,
    )
  }
}
