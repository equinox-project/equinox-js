import { randomUUID } from "crypto"
import { Pool } from "pg"
import { describe, test, expect, beforeAll } from "vitest"
import { Delete, Insert, Update, Upsert, createProjection, executeChanges } from "../src/index.js"

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
})

describe("User table", () => {
  beforeAll(async () => {
    await pool.query(
      `create table if not exists view_data_test (
      id uuid not null primary key,
      name text not null,
      age int not null
    )`,
    )
  })

  const projection = ({ table: "view_data_test", id: ["id"]})

  test("Insert", async () => {
    const id = randomUUID()
    await executeChanges(projection, pool, [Insert({ id, name: "bob", age: 30 })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 30 }])
  })
  test("Update", async () => {
    const id = randomUUID()
    await executeChanges(projection, pool, [Insert({ id, name: "bob", age: 30 })])
    await executeChanges(projection, pool, [Update({ id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 31 }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    await executeChanges(projection, pool, [Insert({ id, name: "bob", age: 30 })])
    await executeChanges(projection, pool, [Delete({ id })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([])
  })

  test("Upsert", async () => {
    const id = randomUUID()
    await executeChanges(projection, pool, [Upsert({ id, name: "bob", age: 30 })])
    await executeChanges(projection, pool, [Upsert({ id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 31 }])
  })
})

beforeAll(async () => {
  await pool.query(
    `create table if not exists view_data_composite_key (
      id uuid not null,
      tenant_id uuid not null,
      name text not null,
      age int not null,
      primary key (id, tenant_id)
    )`,
  )
})

describe("Composite primary key", () => {
  const projection = {
    table: "view_data_composite_key",
    id: ["id", "tenant_id"],
  }

  test("Insert", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await executeChanges(projection, pool, [Insert({ id, tenant_id, name: "bob", age: 30 })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 30 }])
  })
  test("Update", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await executeChanges(projection, pool, [Insert({ id, tenant_id, name: "bob", age: 30 })])
    await executeChanges(projection, pool, [Update({ id, tenant_id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 31 }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await executeChanges(projection, pool, [Insert({ id, tenant_id, name: "bob", age: 30 })])
    await executeChanges(projection, pool, [Delete({ id, tenant_id })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([])
  })

  test("Upsert", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await executeChanges(projection, pool, [Upsert({ id, tenant_id, name: "bob", age: 30 })])
    await executeChanges(projection, pool, [Upsert({ id, tenant_id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 31 }])
  })
})

describe("handler", () => {
  const projection = ({ table: "view_data_composite_key", id: ["id", "tenant_id"]})

  test('Collapses', async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    const handler = createProjection(projection, pool, () => [
      Insert({ id, tenant_id, name: "bob", age: 30 }),
      Update({ id, tenant_id, name: "bobby" }),
      Update({ id, tenant_id, age: 111 }),
    ])
                                             
    await handler(undefined, [])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bobby", age: 111 }])
  })
})
