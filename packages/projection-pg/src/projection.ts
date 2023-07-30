import { ITimelineEvent } from "@equinox-js/core"
import createKnex from "knex"
import { Pool } from "pg"
import { collapseChanges } from "./collapse"
import { Action, Change } from "./types"

// instantiate knex without a db connection since we're only using it for query building
const knex = createKnex({ client: "pg" })

// prettier-ignore: no new lines please
export class Projection<T extends Record<string, any>, Ids extends keyof T> {
  constructor(
    private readonly table: string,
    private readonly idColumns: Ids[],
    private readonly schema = "public",
  ) {}

  changeToQuery(change: Change<T, Ids>) {
    const qb = knex.table(this.table).withSchema(this.schema)
    switch (change.type) {
      case Action.Update:
        return qb
          .where(Object.fromEntries(this.idColumns.map((col) => [col, change.data[col]])))
          .update(change.data)
      case Action.Insert:
        return qb.insert(change.data)
      case Action.Delete:
        return qb.where(change.data).delete()
      case Action.Upsert:
        return qb
          .insert(change.data)
          .onConflict(this.idColumns as string[])
          .merge()
    }
  }

  async execute(pool: Pool, changes: Change<T, Ids>[]) {
    const conn = await pool.connect()
    try {
      await conn.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      for (const change of changes) {
        const query = this.changeToQuery(change)
        const native = query.toSQL().toNative()
        await conn.query(native.sql, native.bindings as any[])
      }
      await conn.query("COMMIT")
    } finally {
      conn.release()
    }
  }

  createHandler(
    pool: Pool,
    changes: (stream: string, events: ITimelineEvent<string>) => Change<T, Ids>[],
  ) {
    return (stream: string, events: ITimelineEvent<string>[]) => {
      const changeset = collapseChanges(events.flatMap((event) => changes(stream, event)))
      return this.execute(pool, changeset)
    }
  }
}
