import { Pool } from "pg"
import { ITimelineEvent } from "@equinox-js/core"

export type Format = string

type ReadCategoryParams = {
  category: string
  fromPositionInclusive: bigint
  batchSize: number
  consumerGroupMember?: number, 
  consumerGroupSize?: number,
  condition?: string 
}

export class MessageDbCategoryReader {
  constructor(private readonly pool: Pool) {}

  private paramsToArray(params: ReadCategoryParams) {
    return [
      params.category,
      String(params.fromPositionInclusive),
      params.batchSize,
      params.consumerGroupMember,
      params.consumerGroupSize,
      params.condition,
    ]
  }

  async readCategoryMessages(params: ReadCategoryParams) {
    const client = await this.pool.connect()
    try {
      const result = await client.query(
        "select * from get_category_messages($1, $2, $3, null, $4, $5, $6)",
        this.paramsToArray(params),
      )
      const messages = result.rows.map(fromDb)
      const isTail = messages.length < params.batchSize
      const checkpoint = result.rows.length
        ? BigInt(result.rows[result.rows.length - 1].global_position) + 1n
        : params.fromPositionInclusive
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
