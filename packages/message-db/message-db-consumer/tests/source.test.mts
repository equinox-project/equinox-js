import { test, expect, afterAll } from "vitest"
import { MessageDbSource } from "../src/index.mjs"
import { Batch, ICheckpoints } from "@equinox-js/propeller"
import { randomUUID } from "crypto"
import { MessageDbCategoryReader } from "../src/lib/MessageDbClient.js"
import { Pool } from "pg"
import { MessageDbConnection, MessageDbContext } from "@equinox-js/message-db"
import { ITimelineEvent, StreamName } from "@equinox-js/core"

class MessageDbReaderSubstitute {
  batches: Batch[] = []
  pushBatch(batch: any) {
    this.batches.push(batch)
  }
  async readCategoryMessages({ fromPositionInclusive }: any) {
    const batch = this.batches.find((b) => b.checkpoint >= fromPositionInclusive + 1n)

    return batch || { items: [], isTail: true, checkpoint: fromPositionInclusive }
  }
}
class MemoryCheckpoints implements ICheckpoints {
  checkpoints = new Map<string, bigint>()
  async load(groupName: string, category: string) {
    return this.checkpoints.get(`${groupName}:${category}`) || 0n
  }
  async commit(groupName: string, category: string, checkpoint: bigint) {
    this.checkpoints.set(`${groupName}:${category}`, checkpoint)
  }
}

const waiter = () => {
  let resolve: (_: unknown) => void
  return [
    new Promise((res) => {
      resolve = res
    }),
    () => resolve(undefined),
  ] as const
}

const connectionString =
  process.env.MDB_CONN_STR ?? "postgres://message_store:@localhost:5432/message_store"
const pool = new Pool({ connectionString })
const reader = new MessageDbCategoryReader(pool)
const conn = MessageDbConnection.create(pool)
const writer = conn.write
afterAll(() => pool.end())

test("Ships batches to the sink", async () => {
  const category = randomUUID().replace(/-/g, "")

  await writer.writeMessages(`${category}-1`, [{ type: "Test" }], null)
  await writer.writeMessages(`${category}-2`, [{ type: "Test" }], null)
  await writer.writeMessages(`${category}-3`, [{ type: "Test" }, { type: "Test" }], null)

  const [wait, resolve] = waiter()

  const streams = new Map<StreamName, ITimelineEvent[]>()
  let count = 0
  const src = MessageDbSource.create({
    pool,
    batchSize: 500,
    maxConcurrentStreams: 10,
    tailSleepIntervalMs: 10,
    maxReadAhead: 3,
    groupName: "test",
    checkpoints: new MemoryCheckpoints(),
    categories: [category],
    async handler(stream, events) {
      streams.set(stream, (streams.get(stream) || []).concat(events))
      if (++count === 3) resolve()
    },
  })

  const ctrl = new AbortController()
  void src.start(ctrl.signal)

  await wait
  ctrl.abort()
  expect(streams.size).toBe(3)
  expect(Array.from(streams.values()).flat()).toHaveLength(4)
})
test("it fails fast", async () => {
  const category = randomUUID().replace(/-/g, "")

  await writer.writeMessages(`${category}-1`, [{ type: "Test" }], null)
  const ctrl = new AbortController()
  const src = MessageDbSource.create({
    pool,
    batchSize: 500,
    maxConcurrentStreams: 10,
    maxReadAhead: 3,
    tailSleepIntervalMs: 10,
    groupName: "test",
    checkpoints: new MemoryCheckpoints(),
    categories: [category],
    async handler(stream, events) {
      throw new Error("failed")
    },
  })

  await expect(src.start(ctrl.signal)).rejects.toThrow("failed")
})
