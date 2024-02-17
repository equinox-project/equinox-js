import { randomUUID } from "crypto"
import type { Client, Transaction } from "@libsql/client"
import { IEventData, ITimelineEvent } from "@equinox-js/core"

type LibSqlWriteResult = { type: "Written"; position: bigint } | { type: "ConflictUnknown" }
export type Format = string

export class LibSqlWriter {
  constructor(private readonly client: Client) {}

  async readStreamVersion(trx: Transaction, streamName: string): Promise<bigint> {
    const result = await trx.execute({
      sql: "select max(position) from messages where stream_name = ?",
      args: [streamName],
    })
    if (result.rows.length === 0) return -1n
    const position = result.rows[0][0] as string
    if (position == null) return -1n
    return BigInt(position)
  }

  async writeMessages(
    category: string,
    streamName: string,
    messages: IEventData<Format>[],
    expectedVersion: bigint | null,
    updateSnapshot?: (trx: Transaction) => Promise<void>,
  ): Promise<LibSqlWriteResult> {
    const trx = await this.client.transaction("write")
    let position = await this.readStreamVersion(trx, streamName)
    if (expectedVersion != null && position !== expectedVersion) {
      await trx.rollback()
      return { type: "ConflictUnknown" }
    }

    try {
      for (let i = 0; i < messages.length; ++i) {
        const message = messages[i]
        await trx.execute({
          sql: `insert into messages(id, stream_name, category, type, data, metadata, position) 
                values (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            message.id || randomUUID(),
            streamName,
            category,
            message.type,
            message.data || null,
            message.meta || null,
            ++position,
          ],
        })
      }
      if (updateSnapshot != null) await updateSnapshot(trx)
      await trx.commit()
    } catch (err: any) {
      await trx.rollback()
      throw err
    }

    return { type: "Written", position }
  }
}

export class LibSqlReader {
  constructor(private readonly client: Client) {}

  async readLastEventWithType(streamName: string, eventType: string) {
    const result = await this.client.execute({
      sql: "select * from messages where stream_name = ? and type = ? order by position desc limit 1",
      args: [streamName, eventType],
    })
    if (result.rows.length === 0) return null
    return Parse.row(result.rows[0])
  }

  async readLastEvent(streamName: string, eventType?: string) {
    if (eventType != null) return this.readLastEventWithType(streamName, eventType)
    const result = await this.client.execute({
      sql: "select * from messages where stream_name = ? order by position desc limit 1",
      args: [streamName],
    })
    if (result.rows.length === 0) return null
    return Parse.row(result.rows[0])
  }

  async readStream(
    streamName: string,
    fromPosition: bigint,
    batchSize: number,
  ): Promise<ITimelineEvent<Format>[]> {
    const result = await this.client.execute({
      sql: "select * from messages where stream_name = ? and position >= ? order by position limit ?",
      args: [streamName, fromPosition.toString(), batchSize],
    })
    return result.rows.map(Parse.row)
  }

  async readSnapshot(streamName: string) {
    const result = await this.client.execute({
      sql: "select * from snapshots where stream_name = ?",
      args: [streamName],
    })
    if (result.rows.length === 0) return
      console.log(result.rows[0])
    return Parse.row(result.rows[0])
  }
}

type DbRow = {
  id: string
  time: string
  type: string
  data?: string
  meta?: string
  position: string
}

namespace Parse {
  export const string = (s: unknown): string => {
    if (typeof s === "string") return s
    throw new Error(`Expected string, got ${typeof s}`)
  }
  export const bigint = (s: unknown): bigint => {
    switch (typeof s) {
      case "string":
      case "number":
        return BigInt(s)
      default:
        throw new Error(`Expected string, got ${typeof s}`)
    }
  }

  export const date = (s: unknown): Date => {
    if (typeof s === "string") return new Date(s)
    throw new Error(`Expected string, got ${typeof s}`)
  }

  export const nullable =
    <T>(parser: (s: unknown) => T) =>
    (s: unknown): T | undefined => {
      if (s == null) return
      return parser(s)
    }

  export const row = (r: any): ITimelineEvent<Format> => {
    const row = r as DbRow
    const data = nullable(string)(row.data)
    const meta = nullable(string)(row.meta)
    const type = string(row.type)
    const time = date(row.time)
    const index = bigint(row.position)
    const id = string(row.id)
    const size = (data?.length ?? 0) + (meta?.length ?? 0) + type.length
    return { id, time, type, data, meta, index, size, isUnfold: false }
  }
}
