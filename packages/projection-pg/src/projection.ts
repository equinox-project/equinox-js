import createKnex, { Knex } from "knex"
import { Pool } from "pg"
import { collapseChanges } from "./collapse"
import { Action, Change } from "./types"

// instantiate knex without a db connection since we're only using it for query building
const knex = createKnex({ client: "pg" })

interface Projection {
  table: string
  schema?: string
  id: string[]
  version?: string
}

function addVersion(
  projection: Projection,
  data: Record<string, any>,
  qb: Knex.QueryBuilder<any, any>,
) {
  if (!projection.version) return qb
  const fullTableName = projection.schema
    ? `${projection.schema}.${projection.table}`
    : projection.table
  const fullColumnName = `${fullTableName}.${projection.version}`
  return qb.andWhere(fullColumnName, "<", data[projection.version])
}

function changeToQuery(projection: Projection, change: Change) {
  const qb = knex.table(projection.table)
  if (projection.schema) qb.withSchema(projection.schema)
  switch (change.type) {
    case Action.Update:
      return addVersion(
        projection,
        change.data,
        qb
          .where(Object.fromEntries(projection.id.map((col) => [col, change.data[col]])))
          .update(change.data),
      )
    case Action.Insert:
      if (!projection.version) {
        return qb.insert(change.data).onConflict(projection.id).ignore()
      }
    // intentional fallthrough in case of versioned entity
    case Action.Upsert:
      return addVersion(
        projection,
        change.data,
        qb.insert(change.data).onConflict(projection.id).merge(),
      )
    case Action.Delete:
      return qb.where(change.data).delete()
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
