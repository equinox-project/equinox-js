import { randomUUID } from "crypto"
import { Pool } from "pg"
import { describe, test, expect, afterAll, beforeAll } from "vitest"
import { Delete, Insert, Update, Upsert, createHandler, createProjection } from "../src/index.js"

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
})
afterAll(() => pool.end())

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

  const projection = { table: "view_data_test", id: ["id"] }
  const handler = createHandler(projection)

  test("Insert", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, name: "bob", age: 30 })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 30 }])
  })
  test("Update", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, name: "bob", age: 30 })])
    await handler(pool, [Update({ id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", age: 31 }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, name: "bob", age: 30 })])
    await handler(pool, [Delete({ id })])
    const { rows } = await pool.query("select * from view_data_test where id = $1", [id])
    expect(rows).toEqual([])
  })

  test("Upsert", async () => {
    const id = randomUUID()
    await handler(pool, [Upsert({ id, name: "bob", age: 30 })])
    await handler(pool, [Upsert({ id, name: "bob", age: 31 })])
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
  const handler = createHandler(projection)

  test("Insert", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await handler(pool, [Insert({ id, tenant_id, name: "bob", age: 30 })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 30 }])
  })
  test("Update", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await handler(pool, [Insert({ id, tenant_id, name: "bob", age: 30 })])
    await handler(pool, [Update({ id, tenant_id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 31 }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await handler(pool, [Insert({ id, tenant_id, name: "bob", age: 30 })])
    await handler(pool, [Delete({ id, tenant_id })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([])
  })

  test("Upsert", async () => {
    const id = randomUUID()
    const tenant_id = randomUUID()
    await handler(pool, [Upsert({ id, tenant_id, name: "bob", age: 30 })])
    await handler(pool, [Upsert({ id, tenant_id, name: "bob", age: 31 })])
    const { rows } = await pool.query("select * from view_data_composite_key where id = $1", [id])
    expect(rows).toEqual([{ id, tenant_id, name: "bob", age: 31 }])
  })
})

describe("With version numbers", () => {
  const projection = {
    table: "with_version",
    id: ["id"],
    version: "version",
  }
  const handler = createHandler(projection)

  beforeAll(async () => {
    await pool.query(
      `create table if not exists with_version (
        id uuid not null,
        name text not null,
        version bigint not null,
        primary key (id)
      )`,
    )
  })

  test("Insert", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 1, name: "bob" })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", version: "1" }])
  })
  test("Update with expired version", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 10, name: "bob" })])
    await handler(pool, [Update({ id, version: 2, name: "bobby" })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", version: "10" }])
  })
  test("Delete", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 0, name: "bob" })])
    await handler(pool, [Delete({ id, version: 1 })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([])
  })
  test("Delete with expired version", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 10, name: "bob" })])
    await handler(pool, [Delete({ id, version: 2 })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", version: "10" }])
  })
  test("Delete with lower version", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 0, name: "bob" })])
    await handler(pool, [Update({ id, version: 1, name: "bobby" })])
    await handler(pool, [Delete({ id, version: 2 })])
    await handler(pool, [Insert({ id, version: 3, name: "bob" })])
    await handler(pool, [Delete({ id, version: 2 })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", version: "3" }])
  })
  test("Upsert with expired version", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 10, name: "bob" })])
    await handler(pool, [Upsert({ id, version: 2, name: "bobby" })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bob", version: "10" }])
  })
  test("More complicated case", async () => {
    const id = randomUUID()
    await handler(pool, [
      Insert({ id, version: 1, name: "bob" }),
      Update({ id, version: 2, name: "bobby" }),
      Delete({ id, version: 3 }),
      Update({ id, version: 4, name: "bobby" }),
      Delete({ id, version: 5 }),
      Insert({ id, version: 6, name: "bobby2" }),
      Update({ id, version: 7, name: "bobby3" }),
      Delete({ id, version: 8 }),
      Insert({ id, version: 9, name: "bobby2" }),
      Update({ id, version: 10, name: "bobby4" }),
    ])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bobby4", version: "10" }])
  })
  test("When a component restarts", async () => {
    const id = randomUUID()
    await handler(pool, [Insert({ id, version: 1, name: "bob" })])
    await handler(pool, [Update({ id, version: 2, name: "bobby" })])
    await handler(pool, [Delete({ id, version: 3 })])
    await handler(pool, [Update({ id, version: 2, name: "bobby" })])
    await handler(pool, [Delete({ id, version: 3 })])
    await handler(pool, [Insert({ id, version: 4, name: "bobby2" })])
    await handler(pool, [Update({ id, version: 5, name: "bobby3" })])
    await handler(pool, [Insert({ id, version: 4, name: "bobby2" })])
    await handler(pool, [Update({ id, version: 5, name: "bobby3" })])
    const { rows } = await pool.query("select * from with_version where id = $1", [id])
    expect(rows).toEqual([{ id, name: "bobby3", version: "5" }])
  })
})

describe("createProjection", () => {
  const projection = { table: "view_data_composite_key", id: ["id", "tenant_id"] }

  test("Collapses", async () => {
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
