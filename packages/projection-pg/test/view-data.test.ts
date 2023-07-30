import { randomUUID } from "crypto"
import { Pool } from "pg"
import { describe, test, expect, beforeAll } from "vitest"
import { Delete, Insert, Update, Upsert, Projection } from "../src/index.js"

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

  const projection = new Projection("view_data_test", ["id"])

  test("Insert", async () => {
    const id = randomUUID()
    await projection.execute(pool, Insert({ id, name: "bob", age: 30 }))
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 30 }])
  })
  test("Update", async () => {
    const id = randomUUID()
    await projection.execute(pool, Insert({ id, name: "bob", age: 30 }))
    await projection.execute(pool, Update({ id, name: "bob", age: 31 }))
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 31 }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    await projection.execute(pool, Insert({ id, name: "bob", age: 30 }))
    await projection.execute(pool, Delete({ id }))
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([])
  })

  test("Upsert", async () => {
    const id = randomUUID()
    await projection.execute(pool, Upsert({ id, name: "bob", age: 30 }))
    await projection.execute(pool, Upsert({ id, name: "bob", age: 31 }))
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
  const projection = new Projection("view_data_composite_key", ["id", "tenant_id"])

  test("Insert", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await projection.execute(pool, Insert({ id, tenant_id, name: "bob", age: 30 }))
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 30 }])
  })
  test("Update", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await projection.execute(pool, Insert({ id, tenant_id, name: "bob", age: 30 }))
    await projection.execute(pool, Update({ id, tenant_id, name: "bob", age: 31 }))
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 31 }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await projection.execute(pool, Insert({ id, tenant_id, name: "bob", age: 30 }))
    await projection.execute(pool, Delete({ id, tenant_id }))
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([])
  })

  test("Upsert", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await projection.execute(pool, Upsert({ id, tenant_id, name: "bob", age: 30 }))
    await projection.execute(pool, Upsert({ id, tenant_id, name: "bob", age: 31 }))
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 31 }])
  })
})

describe("handler", () => {
  const projection = new Projection("view_data_composite_key", ["id", "tenant_id"])

  test('Collapses', async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    const handler = projection.createHandler(pool, () => [
      Insert({ id, tenant_id, name: "bob", age: 30 }),
      Update({ id, tenant_id, name: "bobby" }),
      Update({ id, tenant_id, age: 111 }),
    ])
                                             
    await handler(undefined, [])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bobby", age: 111 }])
  })
})
