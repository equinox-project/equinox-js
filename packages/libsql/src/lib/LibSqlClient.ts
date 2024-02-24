import { randomUUID } from "crypto"
import type { Client, Transaction } from "@libsql/client"
import { IEventData, ITimelineEvent } from "@equinox-js/core"

type LibSqlWriteResult =
  | { type: "Written"; version: bigint; snapshot_etag?: string }
  | { type: "ConflictUnknown" }
export type Format = string

type Trx = {
  execute: Client["execute"]
}

export class LibSqlWriter {
  constructor(private readonly client: Client) {}

  /** version is 0 based, an empty stream has version 0 */
  async readStreamVersion(streamName: string, trx: Trx = this.client): Promise<bigint> {
    const result = await trx.execute({
      sql: `select max("index") from messages where stream_name = ?`,
      args: [streamName],
    })
    if (result.rows.length === 0) return 0n
    const index = result.rows[0][0] as string
    if (index == null) return 0n
    return BigInt(index) + 1n
  }

  async writeMessages(
    category: string,
    streamName: string,
    messages: IEventData<Format>[],
    expectedVersion: bigint | null,
    updateSnapshot?: (trx: Transaction) => Promise<void>,
  ): Promise<LibSqlWriteResult> {
    const trx = await this.client.transaction("write")
    let version = await this.readStreamVersion(streamName, trx)
    if (expectedVersion != null && version !== expectedVersion) {
      await trx.rollback()
      return { type: "ConflictUnknown" }
    }

    try {
      for (let i = 0; i < messages.length; ++i) {
        const message = messages[i]
        await trx.execute({
          sql: `insert into messages(id, stream_name, category, type, data, metadata, "index") 
                values (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            message.id || randomUUID(),
            streamName,
            category,
            message.type,
            message.data || null,
            message.meta || null,
            version++,
          ],
        })
      }
      if (updateSnapshot != null) await updateSnapshot(trx)
      await trx.commit()
    } catch (err: any) {
      await trx.rollback()
      throw err
    }

    return { type: "Written", version }
  }

  async writeSnapshot(
    category: string,
    streamName: string,
    event: IEventData<Format>,
    version: bigint,
    expectedEtag?: string,
  ): Promise<LibSqlWriteResult> {
    const trx = await this.client.transaction("write")
    try {
      const current = await trx.execute({
        sql: "select etag from snapshots where stream_name = ?",
        args: [streamName],
      })
      const currentEtag = current.rows.length === 0 ? undefined : (current.rows[0][0] as string)
      if (currentEtag !== expectedEtag) {
        await trx.rollback()
        return { type: "ConflictUnknown" }
      }
      const nextEtag = randomUUID()
      await trx.execute({
        sql: `
        INSERT INTO snapshots (stream_name, category, type, data, version, etag, id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (stream_name) DO UPDATE
        SET data = excluded.data, version = excluded.version, time = CURRENT_TIMESTAMP, type = excluded.type, id = excluded.id, etag = excluded.etag
      `,
        // prettier-ignore
        args: [streamName, category, event.type, event.data ?? null, version, nextEtag, event.id ?? randomUUID()],
      })
      await trx.commit()
      return { type: "Written", version: version, snapshot_etag: nextEtag }
    } catch (err: any) {
      await trx.rollback()
      throw err
    }
  }
}

export class LibSqlReader {
  constructor(private readonly client: Client) {}

  async readLastEventWithType(streamName: string, eventType: string) {
    const result = await this.client.execute({
      sql: `select * from messages where stream_name = ? and type = ? order by "index" desc limit 1`,
      args: [streamName, eventType],
    })
    if (result.rows.length === 0) return null
    return Parse.row(result.rows[0])
  }

  async readLastEvent(streamName: string, eventType?: string) {
    if (eventType != null) return this.readLastEventWithType(streamName, eventType)
    const result = await this.client.execute({
      sql: `select * from messages where stream_name = ? order by "index" desc limit 1`,
      args: [streamName],
    })
    if (result.rows.length === 0) return null
    return Parse.row(result.rows[0])
  }

  async readStream(
    streamName: string,
    minIndex: bigint,
    batchSize: number,
  ): Promise<ITimelineEvent<Format>[]> {
    const result = await this.client.execute({
      sql: `select * from messages where stream_name = ? and "index" >= ? order by "index" limit ?`,
      args: [streamName, minIndex, batchSize],
    })
    return result.rows.map(Parse.row)
  }

  async readSnapshot(streamName: string): Promise<[string, ITimelineEvent] | undefined> {
    const result = await this.client.execute({
      sql: "select * from snapshots where stream_name = ?",
      args: [streamName],
    })
    if (result.rows.length === 0) return
    const row = result.rows[0]
    return [Parse.string(row.etag), Parse.row(row)]
  }
}

type DbRow = {
  id: string
  time: string
  type: string
  data?: string
  meta?: string
  index: string
  version?: string
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
        throw new Error(`Expected string/number, got ${typeof s}`)
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
    try {
    const row = r as DbRow
    const data = nullable(string)(row.data)
    const meta = nullable(string)(row.meta)
    const type = string(row.type)
    const time = date(row.time)
    const index = bigint(row.index ?? row.version)
    const id = string(row.id)
    const size = (data?.length ?? 0) + (meta?.length ?? 0) + type.length
    return { id, time, type, data, meta, index, size, isUnfold: false }
    } catch (err) {
      throw new Error(`Failed to parse row: ${JSON.stringify(r)}: ${err}`)
    }
  }
}
