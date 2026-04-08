import { describe, test, expect, vi } from "vitest"
import { BatchLimiter, SimpleSink } from "./SimpleSink.mjs"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"
import { setTimeout } from "timers/promises"
import { IngesterBatch } from "./Types.js"

const mkEvent = (type: string, index: bigint): ITimelineEvent => ({
  id: "",
  time: new Date(),
  isUnfold: false,
  size: 0,
  type,
  index,
})

const mkBatch = (onComplete: () => void, index?: bigint, checkpoint = 5n): IngesterBatch => ({
  items: Array.from({ length: 10 }).map((_, i): [StreamName, ITimelineEvent] => [
    StreamName.create("Cat", StreamId.create("stream" + i)),
    mkEvent("Something", index ?? BigInt(i)),
  ]),
  isTail: false,
  checkpoint,
  onComplete,
})

describe("Concurrency", () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "Correctly limits concurrency to %d",
    async (concurrency) => {
      const active = new Set<string>()
      let maxActive = 0
      const ctrl = new AbortController()

      async function handler(stream: StreamName) {
        active.add(stream)
        maxActive = Math.max(maxActive, active.size)
        await new Promise(process.nextTick)
        active.delete(stream)
      }

      const limiter = new BatchLimiter(1)
      const sink = new SimpleSink(handler, concurrency, limiter)
      const sinkP = sink.start(ctrl.signal)

      await sink.pump(
        mkBatch(() => {}),
        ctrl.signal,
      )

      await limiter.waitForEmpty()
      ctrl.abort()

      expect(maxActive).toBe(concurrency)
      await sinkP
    },
  )
})

const streamName = StreamName.parse("Cat-stream1")
const mkSingleBatch = (
  onComplete: (n: bigint) => () => Promise<void>,
  checkpoint: bigint,
): IngesterBatch => ({
  items: [[streamName, mkEvent("Something", checkpoint)]],
  isTail: false,
  checkpoint: checkpoint,
  onComplete: onComplete(checkpoint),
})

test("Correctly limits in-flight batches", async () => {
  let invocations = 0
  const ctrl = new AbortController()

  async function handler() {
    invocations++
    await new Promise(process.nextTick)
  }

  const limiter = new BatchLimiter(3)
  const sink = new SimpleSink(handler, 1, limiter)
  const sinkP = sink.start(ctrl.signal)

  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  expect(sink.pump(mkSingleBatch(complete, 0n), ctrl.signal)).toBeUndefined()
  expect(sink.pump(mkSingleBatch(complete, 1n), ctrl.signal)).toBeUndefined()
  // every third batch is delayed
  await expect(sink.pump(mkSingleBatch(complete, 2n), ctrl.signal)).resolves.toBeUndefined()
  await expect(sink.pump(mkSingleBatch(complete, 3n), ctrl.signal)).resolves.toBeUndefined()
  await expect(sink.pump(mkSingleBatch(complete, 4n), ctrl.signal)).resolves.toBeUndefined()

  await limiter.waitForEmpty()
  expect(sink.pump(mkSingleBatch(complete, 5n), ctrl.signal)).toBeUndefined()
  expect(sink.pump(mkSingleBatch(complete, 6n), ctrl.signal)).toBeUndefined()
  await expect(sink.pump(mkSingleBatch(complete, 7n), ctrl.signal)).resolves.toBeUndefined()

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(8)

  // onComplete is called in order and for every batch
  expect(completed.mock.calls).toEqual(Array.from({ length: 8 }, (_, i) => [BigInt(i)]))
  await sinkP
})

test("Ensures at-most one handler is per active for a stream", async () => {
  let active = 0
  let maxActive = 0
  let invocations = 0
  let events = 0
  const ctrl = new AbortController()

  async function handler(sn: StreamName, evs: unknown[]) {
    events += evs.length
    invocations++
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(process.nextTick)
    active--
  }

  const limiter = new BatchLimiter(10)
  const sink = new SimpleSink(handler, 100, limiter)
  const sinkP = sink.start(ctrl.signal)

  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  const count = 30
  for (let i = 0; i < count; i++) {
    await sink.pump(mkSingleBatch(complete, BigInt(i)), ctrl.signal)
    await new Promise(process.nextTick)
  }

  await limiter.waitForEmpty()
  ctrl.abort()

  // we get 6 invocations of 5 events each
  expect(invocations).toBe(count)
  expect(events).toBe(count)
  expect(maxActive).toBe(1)

  // onComplete is called in order and for every batch
  expect(completed.mock.calls).toEqual(Array.from({ length: count }).map((_, i) => [BigInt(i)]))
  await sinkP
})

test("Does not catch errors from handlers", async () => {
  let invocations = 0
  const ctrl = new AbortController()

  async function handler() {
    invocations++
    await new Promise(process.nextTick)
    throw new Error("Test error")
  }

  const limiter = new BatchLimiter(3)
  const sink = new SimpleSink(handler, 10, limiter)
  const sinkP = sink.start(ctrl.signal)

  const checkpoint = vi.fn().mockResolvedValue(undefined)
  await sink.pump(mkBatch(checkpoint, 0n), ctrl.signal)

  await expect(sinkP).rejects.toThrow("Test error")
  // we need to wait for the other errors to be emitted
  await setTimeout(10)
  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(0)
})

test("Old events are re-submitted if they arrive again", async () => {
  let invocations = 0
  const ctrl = new AbortController()

  async function handler() {
    invocations++
    await new Promise(process.nextTick)
  }

  const limiter = new BatchLimiter(3)
  const sink = new SimpleSink(handler, 10, limiter)
  const sinkP = sink.start(ctrl.signal)

  const checkpoint = vi.fn().mockResolvedValue(undefined)

  // each mkBatch has 1 event in 10 streams
  await sink.pump(mkBatch(checkpoint, 0n, 0n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n, 1n), ctrl.signal)

  await limiter.waitForEmpty()
  expect(invocations).toBe(20)

  // whoopsie, at-least-once delivery means we can receive older events again
  await sink.pump(mkBatch(checkpoint, 0n, 2n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n, 3n), ctrl.signal)
  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(40)
  expect(checkpoint).toHaveBeenCalledTimes(4)
  await sinkP
})

test("At-least once woes", async () => {
  let invocations = 0
  const ctrl = new AbortController()
  const seen: bigint[] = []

  async function handler(sn: StreamName, events: ITimelineEvent[]) {
    invocations++
    for (const e of events) seen.push(e.index)

    await new Promise(process.nextTick)
  }

  const limiter = new BatchLimiter(3)
  const sink = new SimpleSink(handler, 10, limiter)
  const sinkP = sink.start(ctrl.signal)

  const checkpoint = vi.fn().mockResolvedValue(undefined)

  const sn = StreamName.parse("Cat-stream")
  const mkBatch = (items: bigint[]): IngesterBatch => ({
    items: items.map((x) => [sn, mkEvent("Something", x)]),
    isTail: false,
    checkpoint: 1n,
    onComplete: checkpoint,
  })
  const batch1 = mkBatch([0n, 1n, 2n, 3n, 4n, 5n])
  const batch2 = mkBatch([4n, 5n, 6n, 7n, 8n, 9n])

  await sink.pump(batch1, ctrl.signal)
  await sink.pump(batch2, ctrl.signal)

  await limiter.waitForEmpty()
  ctrl.abort()
  expect(invocations).toBe(2)
  expect(seen).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 4n, 5n, 6n, 7n, 8n, 9n])

  await sinkP
})

describe("Handling gaps", () => {
  test("gaps are ignored", async () => {
    let invocations = 0
    const ctrl = new AbortController()
    const seen: bigint[] = []

    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      for (const e of events) seen.push(e.index)

      await new Promise(process.nextTick)
    }

    const limiter = new BatchLimiter(3)
    const sink = new SimpleSink(handler, 10, limiter)
    const sinkP = sink.start(ctrl.signal)

    const checkpoint = vi.fn().mockResolvedValue(undefined)

    const sn = StreamName.parse("Cat-stream")
    const mkBatch = (items: bigint[]): IngesterBatch => ({
      items: items.map((x) => [sn, mkEvent("Something", x)]),
      isTail: false,
      checkpoint: 1n,
      onComplete: checkpoint,
    })
    const batch1 = mkBatch([0n, 1n, 3n, 4n])

    await sink.pump(batch1, ctrl.signal)

    await limiter.waitForEmpty()
    ctrl.abort()
    expect(invocations).toBe(1)
    expect(seen).toEqual([0n, 1n, 3n, 4n])

    await sinkP
  })
})
