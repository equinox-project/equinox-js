import { Pool } from "pg"
import { ITimelineEvent } from "@equinox-js/core"

export type Format = string

export class MessageDbCategoryReader {
  constructor(private readonly pool: Pool) {}

  async readCategoryMessages(category: string, fromPositionInclusive: bigint, batchSize: number) {
    const client = await this.pool.connect()
    try {
      const result = await client.query("select * from get_category_messages($1, $2, $3)", [
        category,
        String(fromPositionInclusive),
        batchSize,
      ])
      const messages = result.rows.map(fromDb)
      const isTail = messages.length < batchSize
      const checkpoint = result.rows.length
        ? BigInt(result.rows[result.rows.length - 1].global_position) + 1n
        : fromPositionInclusive
      return { messages, isTail, checkpoint }
    } finally {
      client.release()
    }
  }
}

function fromDb(row: any): [string, ITimelineEvent<Format>] {
  return [
    row.stream_name,
    {
      size: -1,
      id: row.id,
      time: new Date(row.time),
      type: row.type,
      data: row.data,
      meta: row.metadata,
      index: BigInt(row.position),
      isUnfold: false,
    },
  ]
}
