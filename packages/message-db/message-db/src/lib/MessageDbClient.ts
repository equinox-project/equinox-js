import { Pool } from "pg"
import { randomUUID } from "crypto"
import { IEventData, ITimelineEvent, StreamName } from "@equinox-js/core"

type MdbWriteResult = { type: "Written"; position: bigint } | { type: "ConflictUnknown" }
export type Format = string

export class MessageDbWriter {
  constructor(private readonly pool: Pool) {}
  async writeSingleMessage(
    streamName: string,
    message: IEventData<Format>,
    expectedVersion: bigint | null,
  ): Promise<MdbWriteResult> {
    try {
      const results = await this.pool.query({
        text: `select write_message($1, $2, $3, $4, $5, $6)`,
        name: "write_message",
        values: [
          message.id || randomUUID(),
          streamName,
          message.type,
          message.data || null,
          message.meta || null,
          expectedVersion == null ? null : Number(expectedVersion++),
        ],
      })
      const position = BigInt(results.rows[0].write_message)
      return { type: "Written", position }
    } catch (err: any) {
      if (err?.message?.startsWith("Wrong expected version: ")) {
        return { type: "ConflictUnknown" }
      }
      throw err
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
        const results = await client.query({
          text: `select write_message($1, $2, $3, $4, $5, $6)`,
          name: "write_message",
          values: [
            message.id || randomUUID(),
            streamName,
            message.type,
            message.data || null,
            message.meta || null,
            expectedVersion == null ? null : Number(expectedVersion++),
          ],
        })

        position = BigInt(results.rows[0].write_message)
      }

      await client.query("COMMIT")
    } catch (err: any) {
      await client.query("ROLLBACK")
      if (err?.message?.startsWith("Wrong expected version: ")) {
        return { type: "ConflictUnknown" }
      }
      throw err
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

  private getPool(requiresLeader: boolean) {
    if (requiresLeader) return this.leaderPool
    return this.pool
  }

  async readLastEvent(streamName: string, requiresLeader: boolean, eventType?: string) {
    const result = await this.getPool(requiresLeader).query({
      text: "select * from get_last_stream_message($1, $2)",
      name: "get_last_stream_message",
      values: [streamName, eventType ?? null],
    })
    return result.rows.map(fromDb)[0]
  }

  async readStream(
    streamName: string,
    fromPosition: bigint,
    batchSize: number,
    requiresLeader: boolean,
  ): Promise<ITimelineEvent<Format>[]> {
    const result = await this.getPool(requiresLeader).query({
      text: `select position, type, data, metadata, id, time
         from get_stream_messages($1, $2, $3)`,
      name: "get_stream_messages",
      values: [streamName, String(fromPosition), batchSize],
    })
    return result.rows.map(fromDb)
  }

  async readCorrelatedEvents(
    correlationId: string,
    fromPosition: bigint,
    batchSize: number,
  ): Promise<[StreamName, ITimelineEvent][]> {
    const result = await this.getPool(false).query({
      text: `select global_position as position, stream_name, type, data, metadata, id, time
         from messages
         where metadata->>'$correlationId' = $1
           and global_position > $2
         order by global_position
         limit $3`,
      name: "get_correlated_messages",
      values: [correlationId, String(fromPosition), batchSize],
    })
    return result.rows.map((x) => [StreamName.parse(x.stream_name), fromDb(x)])
  }
}

function fromDb(row: any): ITimelineEvent<Format> {
  return {
    size: (row.data?.length ?? 0) + (row.meta?.length ?? 0) + (row.type?.length ?? 0),
    id: row.id,
    time: new Date(row.time),
    type: row.type,
    data: row.data,
    meta: row.metadata,
    index: BigInt(row.position),
    isUnfold: false,
  }
}
