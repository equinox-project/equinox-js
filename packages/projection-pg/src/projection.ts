import createKnex from "knex"
import { Pool } from "pg"
import { collapseChanges } from "./collapse"
import { Action, Change } from "./types"

// instantiate knex without a db connection since we're only using it for query building
const knex = createKnex({ client: "pg" })

interface Projection {
  table: string
  schema?: string
  id: string[]
}

function changeToQuery(projection: Projection, change: Change) {
  const qb = knex.table(projection.table)
  if (projection.schema) qb.withSchema(projection.schema)
  switch (change.type) {
    case Action.Update:
      return qb
        .where(Object.fromEntries(projection.id.map((col) => [col, change.data[col]])))
        .update(change.data)
    case Action.Insert:
      return qb.insert(change.data)
    case Action.Delete:
      return qb.where(change.data).delete()
    case Action.Upsert:
      return qb
        .insert(change.data)
        .onConflict(projection.id)
        .merge()
  }
}

export async function executeChanges(projection: Projection, pool: Pool, changes: Change[]) {
  const change = collapseChanges(changes)
  if (change == null) return 
  const query = changeToQuery(projection, change).toSQL().toNative()
  await pool.query(query.sql, query.bindings as any[])
}

export function createProjection<T1, T2>(
  projection: Projection,
  pool: Pool,
  changes: (stream: T1, events: T2[]) => Change[],
) {
  return (stream: T1, events: T2[]) => {
    const changeset = changes(stream, events)
    return executeChanges(projection, pool, changeset)
  }
}

