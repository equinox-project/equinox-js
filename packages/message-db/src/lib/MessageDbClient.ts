import { Pool } from "pg"
import { randomUUID } from "crypto"
import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api"
import { StreamEvent, TimelineEvent } from "@equinox-js/core"

type MdbWriteResult =
  | { type: "Written"; position: bigint }
  | { type: "ConflictUnknown" }

export class MessageDbWriter {
  constructor(private readonly pool: Pool) {}

  async writeMessages(
    streamName: string,
    messages: StreamEvent[],
    expectedVersion: bigint | null
  ): Promise<MdbWriteResult> {
    const client = await this.pool.connect()
    let position = -1n
    try {
      await client.query("BEGIN")

      for (let i = 0; i < messages.length; ++i) {
        const message = messages[i]
        const metadata = message.metadata || {}
        propagation.inject(context.active(), metadata)
        const results = await client.query(
          `select position from message_store.write_message($1, $2, $3, $4, $5, $6)`,
          [
            message.id || randomUUID(),
            streamName,
            message.type,
            JSON.stringify(message.data),
            JSON.stringify(metadata || null),
            expectedVersion == null ? null : Number(expectedVersion++),
          ]
        )

        position = results.rows[0].position
      }

      await client.query("COMMIT")
    } catch (err: any) {
      const span = trace.getActiveSpan()
      span?.recordException(err)
      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: "ConflictUnknown",
      })
      return { type: "ConflictUnknown" }
    } finally {
      client.release()
    }
    return { type: "Written", position }
  }
}

export class MessageDbReader {
  constructor(private readonly pool: Pool, private readonly leaderPool: Pool) {}

  private connect(requiresLeader: boolean) {
    if (requiresLeader) return this.leaderPool.connect()
    return this.pool.connect()
  }

  async readLastEvent(
    streamName: string,
    requiresLeader: boolean,
    eventType?: string
  ) {
    const client = await this.connect(requiresLeader)
    try {
      const result = await client.query(
        "select * from message_store.get_last_stream_message($1, $2)",
        [streamName, eventType ?? null]
      )
      return result.rows.map(fromDb)[0]
    } finally {
      client.release()
    }
  }

  async readStream(
    streamName: string,
    fromPosition: bigint,
    batchSize: number,
    requiresLeader: boolean
  ): Promise<TimelineEvent[]> {
    const client = await this.connect(requiresLeader)
    try {
      const result = await client.query(
        `select
           position, type, data, metadata, id::uuid,
           (metadata::jsonb->>'$correlationId')::text,
           (metadata::jsonb->>'$causationId')::text,
           time
         from get_stream_messages($1, $2, $3)`,
        [streamName, String(fromPosition), batchSize]
      )
      return result.rows.map(fromDb)
    } finally {
      client.release()
    }
  }
}

function fromDb(row: any): TimelineEvent {
  return {
    id: row.id,
    stream_name: row.stream_name,
    time: new Date(row.time),
    type: row.type,
    data: JSON.parse(row.data),
    metadata: JSON.parse(row.metadata || "null"),
    position: BigInt(row.position),
  }
}
