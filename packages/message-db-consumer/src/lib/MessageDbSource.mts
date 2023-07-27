import { MessageDbCategoryReader } from "./MessageDbClient.js"
import { ICheckpointer } from "./Checkpoints.js"
import { ITimelineEvent } from "@equinox-js/core"
import { Pool } from "pg"
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api"
import { sleep } from "./Sleep.js"
import pLimit from "p-limit"

type Options = {
  categories: string[]
  batchSize?: number
  groupName: string
  checkpointer: ICheckpointer
  handler: (streamName: string, events: ITimelineEvent<string>[]) => Promise<void>
  tailSleepIntervalMs: number
  maxConcurrentStreams: number
  condition?: string
}

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
          "eqx.category": category,
          "eqx.consumer_group": this.options.groupName,
          "eqx.stream_name": streamName,
          "eqx.tail_sleep_interval_ms": this.options.tailSleepIntervalMs,
          "eqx.max_concurrent_streams": this.options.maxConcurrentStreams,
          "eqx.batch_size": this.options.batchSize ?? defaultBatchSize,
          "eqx.stream_version": Number(events[events.length - 1]!.index),
          "eqx.count": events.length,
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
      condition = null
    } = this.options
    let position = await checkpointer.load(groupName, category)
    while (!signal.aborted) {
      const batch = await this.client.readCategoryMessages(category, position, batchSize, condition)
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
        await checkpointer.commit(groupName, category, batch.checkpoint)
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
