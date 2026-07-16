import { test, expect, afterAll } from "vitest"
import { randomUUID } from "crypto"
import { Pool } from "pg"
import { PgCheckpoints } from "../src/lib/Checkpoints.js"

const connectionString =
  process.env.MDB_CONN_STR ?? "postgres://message_store:@localhost:5432/message_store"
const pool = new Pool({ connectionString })
afterAll(() => pool.end())

test("load returns the value resolved by establishOrigin when no checkpoint exists", async () => {
  const checkpoints = new PgCheckpoints(pool)
  await checkpoints.ensureTable()
  const groupName = randomUUID()
  const category = randomUUID()

  const position = await checkpoints.load(groupName, category, async () => 42n)

  expect(position).toBe(42n)
})
