import { MessageDbCategoryReader } from "./MessageDbClient"
import { ICheckpointer } from "./Checkpoints"
import { ITimelineEvent } from "@equinox-js/core"
import { Pool } from "pg"

type Options = {
  categories: string[]
  batchSize?: number
  groupName: string
  checkpointer: ICheckpointer
  handler: (streamName: string, events: ITimelineEvent<string>[]) => Promise<void>
  tailSleepIntervalMs: number
}

export class MessageDbSource {
  constructor(
    private readonly client: MessageDbCategoryReader,
    private readonly options: Options,
  ) {}

  private async pumpCategory(signal: AbortSignal, category: string) {
    const { handler, groupName, checkpointer, tailSleepIntervalMs, batchSize = 500 } = this.options
    let position = await checkpointer.load(groupName, category)
    while (!signal.aborted) {
      const batch = await this.client.readCategoryMessages(category, position, batchSize)
      if (signal.aborted) return
      const byStreamName = new Map<string, ITimelineEvent<string>[]>()
      for (let i = 0; i < batch.messages.length; ++i) {
        const [streamName, msg] = batch.messages[i]
        if (!byStreamName.has(streamName)) byStreamName.set(streamName, [])
        byStreamName.get(streamName)!.push(msg)
      }

      for (const [stream, events] of byStreamName.entries()) {
        await handler(stream, events)
      }
      if (batch.checkpoint != position) {
        await checkpointer.commit(groupName, category, batch.checkpoint)
        position = batch.checkpoint
      }
      if (batch.isTail) await new Promise((res) => setTimeout(res, tailSleepIntervalMs))
    }
  }

  async start(signal: AbortSignal) {
    return Promise.all(
      this.options.categories.map((category) => this.pumpCategory(signal, category)),
    )
  }

  static create(options: Options & { pool: Pool }) {
    const client = new MessageDbCategoryReader(options.pool)
    return new MessageDbSource(client, options)
  }
}
