import { Pool, PoolClient } from "pg"
import { describe, test, expect, afterAll } from "vitest"
import { PayerId } from "../../src/domain/identifiers.js"
import * as Payer from "../../src/domain/payer.js"
import * as PayerReadModel from "../../src/read-models/PayerReadModel.js"

const pool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/postgres",
  // we start a transaction in the beforeAll hook and roll it back after each test
  max: 1,
})

afterAll(() => pool.end())

function execute(fn: (client: PoolClient) => Promise<void>) {
  return async () => {
    const client = await pool.connect()
    try {
      await client.query("truncate table payer")
      await client.query("begin")
      await fn(client)
    } finally {
      await pool.query("rollback")
    }
  }
}

describe("PayerReadModel", () => {
  test("Inserting a payer", () =>
    execute(async (client) => {
      const id = PayerId.create()
      const streamId = Payer.Stream.streamId(id)
      await PayerReadModel.project(client, streamId, { name: "Test", email: "test@example.com" }, 1n)
      const result = await client.query("select * from payer")
      expect(result.rows).toEqual([{ name: "Test", email: "test@example.com" }])
    }))
  test("Upserting a payer", () =>
    execute(async (client) => {
      const id = PayerId.create()
      const streamId = Payer.Stream.streamId(id)
      await PayerReadModel.project(client, streamId, { name: "Test", email: "test@example.com" }, 1n)
      await PayerReadModel.project(client, streamId, { name: "Test 2", email: "test@example.com" }, 2n)
      const result = await client.query("select * from payer")
      expect(result.rows).toEqual([{ name: "Test 2", email: "test@example.com" }])
    }))

  test("Deleting a payer", () =>
    execute(async (client) => {
      const id = PayerId.create()
      const streamId = Payer.Stream.streamId(id)

      await PayerReadModel.project(client, streamId, { name: "Test", email: "test@example.com" }, 1n)
      await PayerReadModel.project(client, streamId, null, 2n)
    }))
})
