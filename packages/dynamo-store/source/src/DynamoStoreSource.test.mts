import { test, expect } from "vitest"
import { DynamoStoreSource, LoadMode } from "./DynamoStoreSource.mjs"
import { ICheckpoints } from "@equinox-js/propeller"
import { VolatileStore } from "@equinox-js/memory-store"
import {
  AppendsEpoch,
  AppendsEpochId,
  AppendsIndex,
  AppendsPartitionId,
  IndexStreamId,
} from "@equinox-js/dynamo-store-indexer"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"
import zlib from "zlib"

class MemoryCheckpoints implements ICheckpoints {
  checkpoints = new Map<string, bigint>()
  loaded = waiter()

  async load(groupName: string, category: string, establish?: (t: string) => Promise<bigint>) {
    let value = this.checkpoints.get(`${groupName}:${category}`)
    if (value == null) {
      value = (await establish?.(category)) || 0n
    }
    process.nextTick(this.loaded[1])
    return value
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
  const store = new VolatileStore()
  const index = AppendsIndex.Reader.createMem(store)
  const epochs = AppendsEpoch.Reader.Config.createMem(store)
  const streams = new Map<string, any[]>()
  let count = 0
  const src = new DynamoStoreSource(index, epochs, {
    categories: ["Cat"],
    batchSizeCutoff: 10,
    tailSleepIntervalMs: 10,
    maxConcurrentBatches: 10,
    maxConcurrentStreams: 1,
    mode: LoadMode.IndexOnly(),
    groupName: "test",
    checkpoints: new MemoryCheckpoints(),
    async handler(stream, events) {
      streams.set(stream, (streams.get(stream) || []).concat(events))
      if (++count === 3) ctrl.abort()
    },
  })

  const ctrl = new AbortController()

  const epochWriter = AppendsEpoch.Config.createMem(1024 * 1024, 5000n, 100_000, store)

  await epochWriter.ingest(AppendsPartitionId.wellKnownId, AppendsEpochId.initial, [
    { p: IndexStreamId.ofString("Cat-stream1"), i: 1, c: ["Something"] },
    { p: IndexStreamId.ofString("Cat-stream2"), i: 1, c: ["Something"] },
    { p: IndexStreamId.ofString("Cat-stream3"), i: 1, c: ["Something", "Something"] },
  ])

  await src.start(ctrl.signal).catch(() => {})
  expect(streams.size).toBe(3)
  expect(Array.from(streams.values()).flat()).toHaveLength(4)
})

test("it fails fast", async () => {
  const store = new VolatileStore()
  const index = AppendsIndex.Reader.createMem(store)
  const epochs = AppendsEpoch.Reader.Config.createMem(store)
  const ctrl = new AbortController()
  const src = new DynamoStoreSource(index, epochs, {
    categories: ["Cat"],
    batchSizeCutoff: 10,
    tailSleepIntervalMs: 10,
    maxConcurrentStreams: 10,
    maxConcurrentBatches: 10,
    groupName: "test",
    mode: LoadMode.IndexOnly(),
    checkpoints: new MemoryCheckpoints(),
    async handler() {
      throw new Error("failed")
    },
  })
  const epochWriter = AppendsEpoch.Config.createMem(1024 * 1024, 5000n, 100_000, store)
  await epochWriter.ingest(
    AppendsPartitionId.wellKnownId,
    AppendsEpochId.initial,
    Array.from({ length: 10 }).map((_, i) => ({
      p: IndexStreamId.ofString("Cat-stream" + i),
      i: 1,
      c: ["Something"],
    })),
  )

  await expect(src.start(ctrl.signal)).rejects.toThrow("failed")
})

const createTimelineEvent = (i: number, type: string, body: any): ITimelineEvent => ({
  id: "",
  type,
  isUnfold: false,
  size: 0,
  index: BigInt(i),
  time: new Date(),
  data: JSON.stringify(body),
  meta: undefined,
})
test("loading event bodies", async () => {
  const store = new VolatileStore<any>()
  const index = AppendsIndex.Reader.createMem(store)
  const epochs = AppendsEpoch.Reader.Config.createMem(store)
  const ctrl = new AbortController()
  const received = new Map<StreamName, ITimelineEvent[]>()
  const expectedStreams = new Map<StreamName, ITimelineEvent[]>()
  for (let i = 0; i < 10; ++i) {
    const sn = StreamName.create("Cat", StreamId.create(`stream${i}`))
    expectedStreams.set(sn, [
      createTimelineEvent(0, "Something", { hello: "a" }),
      createTimelineEvent(1, "Something", { hello: "b" }),
    ])
  }
  const [wait, resolve] = waiter()
  const src = new DynamoStoreSource(index, epochs, {
    categories: ["Cat"],
    batchSizeCutoff: 10,
    tailSleepIntervalMs: 10,
    maxConcurrentStreams: 10,
    maxConcurrentBatches: 10,
    groupName: "test",
    mode: LoadMode.WithDataEx(10, async (sn, i, count) => {
      const events = store.load(sn)
      return events.slice(i, i + count)
    }),
    checkpoints: new MemoryCheckpoints(),
    async handler(stream, evs) {
      const events = received.get(stream) || []
      events.push(...evs)
      received.set(stream, events)
      if (Array.from(received.values()).flat().length === 20) {
        resolve()
        ctrl.abort()
      }
    },
  })
  void src.start(ctrl.signal).catch(() => {})
  const epochWriter = AppendsEpoch.Config.createMem(1024 * 1024, 5000n, 100_000, store)
  for (const [sn, events] of expectedStreams) {
    store.sync(
      sn,
      0,
      events.map((x) => ({
        ...x,
        data:
          // Randomly pick deflated/raw bodies to ensure both work seemlessly
          Math.random() < 1 / 3
            ? {
                encoding: 1,
                body: zlib.deflateRawSync(Buffer.from(x.data!), {
                  flush: zlib.constants.Z_NO_FLUSH,
                }),
              }
            : Math.random() < 0.5
            ? { encoding: 2, body: zlib.brotliCompressSync(Buffer.from(x.data!)) }
            : { encoding: 0, body: Buffer.from(x.data!) },
      })),
    )
    await epochWriter.ingest(AppendsPartitionId.wellKnownId, AppendsEpochId.initial, [
      {
        p: IndexStreamId.ofString(sn),
        i: 0,
        c: events.map((x) => x.type),
      },
    ])
  }
  await wait
  expect(received).toEqual(expectedStreams)
})

test("starting from the tail of the store", async () => {
  const store = new VolatileStore()
  const index = AppendsIndex.Reader.createMem(store)
  const epochs = AppendsEpoch.Reader.Config.createMem(store)
  const [wait, resolve] = waiter()
  let received
  const checkpoints = new MemoryCheckpoints()
  const src = new DynamoStoreSource(index, epochs, {
    categories: ["Cat"],
    batchSizeCutoff: 10,
    tailSleepIntervalMs: 10,
    maxConcurrentBatches: 10,
    maxConcurrentStreams: 1,
    mode: LoadMode.IndexOnly(),
    startFromTail: true,
    groupName: "test",
    checkpoints,
    async handler(stream, events) {
      received = [stream, events]
      resolve()
    },
  })

  const ctrl = new AbortController()

  const epochWriter = AppendsEpoch.Config.createMem(1024 * 1024, 5000n, 100_000, store)

  await epochWriter.ingest(AppendsPartitionId.wellKnownId, AppendsEpochId.initial, [
    { p: IndexStreamId.ofString("Cat-stream1"), i: 0, c: ["Something"] },
    { p: IndexStreamId.ofString("Cat-stream2"), i: 0, c: ["Something"] },
    { p: IndexStreamId.ofString("Cat-stream3"), i: 0, c: ["Something", "Something"] },
  ])

  const p = src.start(ctrl.signal)
  await checkpoints.loaded[0] // give it a chance to load the checkpoint
  await epochWriter.ingest(AppendsPartitionId.wellKnownId, AppendsEpochId.initial, [
    { p: IndexStreamId.ofString("Cat-stream3"), i: 2, c: ["Something", "Something"] },
  ])

  await wait
  ctrl.abort()
  await p
  expect(received).toEqual([
    "Cat-stream3",
    [
      expect.objectContaining({ type: "Something" }),
      expect.objectContaining({ type: "Something" }),
    ],
  ])
})
