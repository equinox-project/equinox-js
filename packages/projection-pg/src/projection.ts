import { Client, Pool } from "pg"
import { collapseChanges } from "./collapse"
import { Action, Change } from "./types"
import { ident } from "./quote"

interface Projection {
  table: string
  schema?: string
  id: string[]
  version?: string
}

function tableName(projection: Projection) {
  const schema = ident(projection.schema || "public")
  return `${schema}.${ident(projection.table)}`
}

function update(projection: Projection, change: Change) {
  const table = tableName(projection)
  const pkeyColumns: string[] = []
  const pkeyValues: any[] = []
  const dataColumns: string[] = []
  const dataValues: any[] = []
  let versionIdx = -1

  for (const [key, value] of Object.entries(change.data)) {
    if (projection.id.includes(key)) {
      pkeyColumns.push(ident(key))
      pkeyValues.push(value)
    } else {
      if (key === projection.version) {
        versionIdx = dataColumns.length
      }
      dataColumns.push(ident(key))
      dataValues.push(value)
    }
  }

  const setClause = dataColumns.map((col, i) => `${col} = $${i + 1}`).join(", ")
  const whereClause = pkeyColumns
    .map((col, i) => `${col} = $${i + 1 + dataColumns.length}`)
    .join(" and ")
  const values = [...dataValues, ...pkeyValues]
  let query = `update ${table} set ${setClause} where ${whereClause}`
  if (versionIdx >= 0) {
    const col = dataColumns[versionIdx]
    query += ` and ${col} < $${versionIdx + 1}`
  }
  return { text: query, values }
}

function insert(projection: Projection, change: Change) {
  const table = tableName(projection)
  const columns: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(change.data)) {
    columns.push(ident(key))
    values.push(value)
  }
  const pkeyColumns = projection.id.map(ident).join(", ")
  const quotedColumns = columns.join(", ")
  const valuesClause = values.map((_, i) => `$${i + 1}`).join(", ")
  const query = `insert into ${table} (${quotedColumns}) values (${valuesClause}) on conflict (${pkeyColumns}) do nothing`
  return { text: query, values }
}

function del(projection: Projection, change: Change) {
  const table = tableName(projection)
  const columns: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(change.data)) {
    if (key === projection.version) continue
    columns.push(ident(key))
    values.push(value)
  }

  const whereClause = columns.map((col, i) => `${col} = $${i + 1}`).join(" and ")
  let query = `delete from ${table} where ${whereClause}`
  if (projection.version) {
    values.push(change.data[projection.version])
    query += ` and ${ident(projection.version)} < $${values.length}`
  }
  return { text: query, values }
}

function upsert(projection: Projection, change: Change) {
  const table = tableName(projection)
  const columns: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(change.data)) {
    columns.push(ident(key))
    values.push(value)
  }
  const pkeyColumns = projection.id.map(ident).join(", ")
  const quotedColumns = columns.join(", ")
  const valuesClause = values.map((_, i) => `$${i + 1}`).join(", ")
  let query = `insert into ${table} (${quotedColumns}) values (${valuesClause})`
  query += ` on conflict (${pkeyColumns}) do update set `
  query += columns.map((col) => `${col} = EXCLUDED.${col}`).join(", ")
  if (projection.version) {
    const versionColumn = ident(projection.version)
    query += ` where ${table}.${versionColumn} < EXCLUDED.${versionColumn}`
  }
  return { text: query, values }
}

function changeToQuery(projection: Projection, change: Change) {
  switch (change.type) {
    case Action.Update:
      return update(projection, change)
    case Action.Insert:
      if (!projection.version) return insert(projection, change)
    // intentional fallthrough in case of versioned entity
    case Action.Upsert:
      return upsert(projection, change)
    case Action.Delete:
      return del(projection, change)
  }
}

export interface MinimalClient {
  query: Client["query"]
}

export function createHandler(projection: Projection) {
  return async function handle(client: MinimalClient, changes: Change[]) {
    const change = collapseChanges(changes)
    if (change == null) return
    const query = changeToQuery(projection, change)
    await client.query(query)
  }
}

export function createProjection<T1, T2>(
  projection: Projection,
  pool: Pool,
  changes: (stream: T1, events: T2[]) => Change[],
) {
  const handler = createHandler(projection)
  return (stream: T1, events: T2[]) => {
    const changeset = changes(stream, events)
    return handler(pool, changeset)
  }
}
