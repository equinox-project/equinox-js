import { test, expect, afterAll } from "vitest"
import { MessageDbSource } from "../src/index.mjs"
import { ICheckpoints, StreamsSink } from "@equinox-js/propeller"
import { randomUUID } from "crypto"
import { Pool } from "pg"
import { MessageDbConnection} from "@equinox-js/message-db"
import { ITimelineEvent, StreamName } from "@equinox-js/core"

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
  const sink = StreamsSink.create({
    async handler(stream, events) {
      streams.set(stream, (streams.get(stream) || []).concat(events))
      if (++count === 3) resolve()
    },
    maxConcurrentStreams: 10,
    maxReadAhead: 3,
  })

  const src = MessageDbSource.create({
    pool,
    batchSize: 500,
    tailSleepIntervalMs: 10,
    groupName: "test",
    checkpoints: new MemoryCheckpoints(),
    categories: [category],
    sink,
  })

  const ctrl = new AbortController()
  const sourceP = src.start(ctrl.signal)

  await wait
  ctrl.abort()
  expect(streams.size).toBe(3)
  expect(Array.from(streams.values()).flat()).toHaveLength(4)
  await expect(sourceP).rejects.toThrow("This operation was aborted")
})
test("it fails fast", async () => {
  const category = randomUUID().replace(/-/g, "")

  await writer.writeMessages(`${category}-1`, [{ type: "Test" }], null)
  const ctrl = new AbortController()
  const sink = StreamsSink.create({
    async handler() {
      throw new Error("failed")
    },
    maxConcurrentStreams: 10,
    maxReadAhead: 3,
  })

  const src = MessageDbSource.create({
    pool,
    batchSize: 500,
    sink,
    tailSleepIntervalMs: 10,
    groupName: "test",
    checkpoints: new MemoryCheckpoints(),
    categories: [category],
  })

  await expect(src.start(ctrl.signal)).rejects.toThrow("failed")
})
