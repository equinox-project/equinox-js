import { Pool } from "pg"
import { randomUUID } from "crypto"
import { IEventData, ITimelineEvent } from "@equinox-js/core"

type MdbWriteResult = { type: "Written"; position: bigint } | { type: "ConflictUnknown" }
export type Format = string

export class MessageDbWriter {
  constructor(private readonly pool: Pool) {}
  async writeSingleMessage(
    streamName: string,
    message: IEventData<Format>,
    expectedVersion: bigint | null,
  ): Promise<MdbWriteResult> {
    const client = await this.pool.connect()
    try {
      const results = await client.query(
        `select message_store.write_message($1, $2, $3, $4, $5, $6)`,
        [
          message.id || randomUUID(),
          streamName,
          message.type,
          message.data || null,
          message.meta || null,
          expectedVersion == null ? null : Number(expectedVersion++),
        ],
      )
      const position = BigInt(results.rows[0].write_message)
      return { type: "Written", position }
    } catch (err: any) {
      return { type: "ConflictUnknown" }
    } finally {
      client.release()
    }
  }

  async writeMessages(
    streamName: string,
    messages: IEventData<Format>[],
    expectedVersion: bigint | null,
  ): Promise<MdbWriteResult> {
    if (messages.length === 1)
      return this.writeSingleMessage(streamName, messages[0], expectedVersion)
    const client = await this.pool.connect()
    let position = -1n
    try {
      await client.query("BEGIN")

      for (let i = 0; i < messages.length; ++i) {
        const message = messages[i]
        const results = await client.query(
          `select message_store.write_message($1, $2, $3, $4, $5, $6)`,
          [
            message.id || randomUUID(),
            streamName,
            message.type,
            message.data || null,
            message.meta || null,
            expectedVersion == null ? null : Number(expectedVersion++),
          ],
        )

        position = BigInt(results.rows[0].write_message)
      }

      await client.query("COMMIT")
    } catch (err: any) {
      await client.query("ROLLBACK")
      return { type: "ConflictUnknown" }
    } finally {
      client.release()
    }
    return { type: "Written", position }
  }
}

export class MessageDbReader {
  constructor(
    private readonly pool: Pool,
    private readonly leaderPool: Pool,
  ) {}

  private connect(requiresLeader: boolean) {
    if (requiresLeader) return this.leaderPool.connect()
    return this.pool.connect()
  }

  async readLastEvent(streamName: string, requiresLeader: boolean, eventType?: string) {
    const client = await this.connect(requiresLeader)
    try {
      const result = await client.query(
        "select * from message_store.get_last_stream_message($1, $2)",
        [streamName, eventType ?? null],
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
    requiresLeader: boolean,
  ): Promise<ITimelineEvent<Format>[]> {
    const client = await this.connect(requiresLeader)
    try {
      const result = await client.query(
        `select position, type, data, metadata, id, time
         from get_stream_messages($1, $2, $3)`,
        [streamName, String(fromPosition), batchSize],
      )
      return result.rows.map(fromDb)
    } finally {
      client.release()
    }
  }
}

function fromDb(row: any): ITimelineEvent<Format> {
  return {
    size: -1,
    id: row.id,
    time: new Date(row.time),
    type: row.type,
    data: row.data,
    meta: row.metadata,
    index: BigInt(row.position),
    isUnfold: false,
  }
}
