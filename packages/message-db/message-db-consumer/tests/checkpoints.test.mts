import { test, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "crypto"
import { Pool } from "pg"
import { PgCheckpoints } from "../src/lib/Checkpoints.js"

const connectionString =
  process.env.MDB_CONN_STR ?? "postgres://message_store:@localhost:5432/message_store"
const pool = new Pool({ connectionString })
// The message_store role only has privileges on the message_store schema, not
// on public, so the checkpoint table has to be created by a superuser (mirrors
// how ensureTable is expected to be run in a migration, not by the app role).
const adminPool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/message_store",
})
const checkpoints = new PgCheckpoints(pool)
beforeAll(async () => {
  await checkpoints.ensureTable(adminPool)
  await adminPool.query("grant select, insert, update on public.eqx_checkpoint to message_store")
})
afterAll(() => Promise.all([pool.end(), adminPool.end()]))

test("load returns the value resolved by establishOrigin when no checkpoint exists", async () => {
  const groupName = randomUUID()
  const category = randomUUID()

  const position = await checkpoints.load(groupName, category, async () => 42n)

  expect(position).toBe(42n)
})
