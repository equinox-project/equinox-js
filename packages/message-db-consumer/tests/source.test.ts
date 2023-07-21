import { test, expect } from "vitest"
import { ICheckpointer, MessageDbSource } from "../src/index.js"
import { sleep } from "../src/lib/Sleep.js"

class MessageDbReaderSubstitute {
  batches: any[] = []
  pushBatch(batch: any) {
    this.batches.push(batch)
  }
  async readCategoryMessages(category: string, fromPositionInclusive: bigint, batchSize: number) {
    const batch = this.batches.find((b) => b.checkpoint >= fromPositionInclusive + 1n)

    return batch || { messages: [], isTail: true, checkpoint: fromPositionInclusive }
  }
}
class MemoryCheckpoints implements ICheckpointer {
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

test("Correctly batches stream handling", async () => {
  const reader = new MessageDbReaderSubstitute()
  const streams = new Map<string, any[]>()
  const [wait, resolve] = waiter()
  let count = 0
  const src = new MessageDbSource(reader as any, {
    categories: ["test"],
    batchSize: 10,
    tailSleepIntervalMs: 10,
    maxConcurrentStreams: 1,
    groupName: "test",
    checkpointer: new MemoryCheckpoints(),
    async handler(stream, events) {
      streams.set(stream, (streams.get(stream) || []).concat(events))
      if (++count === 3) resolve()
    },
  })

  const ctrl = new AbortController()
  void src.start(ctrl.signal)

  reader.pushBatch({
    messages: [
      ["stream1", { index: 1n, time: new Date() }],
      ["stream2", { index: 4n, time: new Date() }],
      ["stream3", { index: 5n, time: new Date() }],
      ["stream3", { index: 6n, time: new Date() }],
    ],
    isTail: false,
    checkpoint: 6n,
  })

  await wait
  ctrl.abort()
  expect(streams.size).toBe(3)
  expect(Array.from(streams.values()).flat()).toHaveLength(4)
})

test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
  "Correctly limits concurrency to %d",
  async (concurrency) => {
    const reader = new MessageDbReaderSubstitute()
    const active = new Set<string>()
    let maxActive = 0
    const [wait, resolve] = waiter()
    let count = 0
    const ctrl = new AbortController()
    const src = new MessageDbSource(reader as any, {
      categories: ["test"],
      batchSize: 10,
      tailSleepIntervalMs: 10,
      maxConcurrentStreams: concurrency,
      groupName: "test",
      checkpointer: new MemoryCheckpoints(),
      async handler(stream, events) {
        active.add(stream)
        maxActive = Math.max(maxActive, active.size)
        await sleep(10, ctrl.signal)
        active.delete(stream)
        count += events.length
        if (count == 10) resolve()
      },
    })

    void src.start(ctrl.signal)

    reader.pushBatch({
      messages: Array.from({ length: 10 }).map((_, i) => [
        "stream" + i,
        { index: 1n, time: new Date() },
      ]),
      isTail: false,
      checkpoint: 6n,
    })

    await wait
    ctrl.abort()
    expect(maxActive).toBe(concurrency)
  },
)

test("it fails fast", async () => {
  const reader = new MessageDbReaderSubstitute()
  const ctrl = new AbortController()
  const src = new MessageDbSource(reader as any, {
    categories: ["test"],
    batchSize: 10,
    tailSleepIntervalMs: 10,
    maxConcurrentStreams: 10,
    groupName: "test",
    checkpointer: new MemoryCheckpoints(),
    async handler(stream, events) {
      throw new Error("failed")
    },
  })

  reader.pushBatch({
    messages: Array.from({ length: 10 }).map((_, i) => [
      "stream" + i,
      { index: 1n, time: new Date() },
    ]),
    isTail: false,
    checkpoint: 6n,
  })

  await expect(src.start(ctrl.signal)).rejects.toThrow("failed")
})
