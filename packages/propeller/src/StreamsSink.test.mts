import { describe, test, expect, vi, should } from "vitest"
import { BatchLimiter, StreamsSink } from "./StreamsSink.mjs"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"
import { setTimeout } from "timers/promises"
import { IngesterBatch } from "./Types.js"
import { StreamResult } from "./Sinks.js"

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
        await new Promise(setImmediate)
        active.delete(stream)
      }

      const limiter = new BatchLimiter(1)
      const sink = new StreamsSink(handler, concurrency, limiter)
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

test("Correctly merges batches", async () => {
  let invocations = 0
  const ctrl = new AbortController()

  async function handler() {
    invocations++
    await new Promise(setImmediate)
  }

  const limiter = new BatchLimiter(3)
  const sink = new StreamsSink(handler, 10, limiter)
  const sinkP = sink.start(ctrl.signal)

  const checkpoint = vi.fn().mockResolvedValue(undefined)

  // each mkBatch has 1 event in 10 streams
  await sink.pump(mkBatch(checkpoint, 0n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n), ctrl.signal)

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(2)
  await sinkP
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
    await setTimeout(10)
  }

  const limiter = new BatchLimiter(3)
  const sink = new StreamsSink(handler, 1, limiter)
  const sinkP = sink.start(ctrl.signal)

  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  expect(sink.pump(mkSingleBatch(complete, 0n), ctrl.signal)).toBeUndefined()
  expect(sink.pump(mkSingleBatch(complete, 1n), ctrl.signal)).toBeUndefined()
  // every third batch is delayed
  await expect(sink.pump(mkSingleBatch(complete, 2n), ctrl.signal)).resolves.toBeUndefined()
  expect(sink.pump(mkSingleBatch(complete, 3n), ctrl.signal)).toBeUndefined()
  expect(sink.pump(mkSingleBatch(complete, 4n), ctrl.signal)).toBeUndefined()
  await expect(sink.pump(mkSingleBatch(complete, 5n), ctrl.signal)).resolves.toBeUndefined()

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(2)

  // onComplete is called in order and for every batch
  expect(completed.mock.calls).toEqual(Array.from({ length: 6 }, (_, i) => [BigInt(i)]))
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
    await setTimeout(10)
    active--
  }

  const limiter = new BatchLimiter(10)
  const sink = new StreamsSink(handler, 100, limiter)
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
  expect(invocations).toBe(6)
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
    await new Promise(setImmediate)
    throw new Error("Test error")
  }

  const limiter = new BatchLimiter(3)
  const sink = new StreamsSink(handler, 10, limiter)
  const sinkP = sink.start(ctrl.signal)

  const checkpoint = vi.fn().mockResolvedValue(undefined)
  const onError = vi.fn()
  // We need to capture all the errors otherwise the test will fail
  sink["events"].on("error", onError)

  await sink.pump(mkBatch(checkpoint, 0n), ctrl.signal)

  await expect(sinkP).rejects.toThrow("Test error")
  // we need to wait for the other errors to be emitted
  await setTimeout(10)
  expect(onError).toHaveBeenCalledTimes(10)
  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(1)
})

test("Old events are ignored even if re-submitted", async () => {
  let invocations = 0
  const ctrl = new AbortController()

  async function handler() {
    invocations++
    await new Promise(setImmediate)
  }

  const limiter = new BatchLimiter(3)
  const sink = new StreamsSink(handler, 10, limiter)
  const sinkP = sink.start(ctrl.signal)

  const checkpoint = vi.fn().mockResolvedValue(undefined)

  // each mkBatch has 1 event in 10 streams
  await sink.pump(mkBatch(checkpoint, 0n, 0n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n, 1n), ctrl.signal)

  await limiter.waitForEmpty()
  expect(invocations).toBe(10)

  // whoopsie, at-least-once delivery means we can receive older events again
  await sink.pump(mkBatch(checkpoint, 0n, 2n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n, 3n), ctrl.signal)
  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(4)
  await sinkP
})

describe("At-least once woes", () => {
  async function runTest(waitBeforeMerge: boolean) {
    let invocations = 0
    const ctrl = new AbortController()
    const seen: bigint[] = []

    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      for (const e of events) seen.push(e.index)

      await new Promise(setImmediate)
    }

    const limiter = new BatchLimiter(3)
    const sink = new StreamsSink(handler, 10, limiter)
    const sinkP = sink.start(ctrl.signal)

    const checkpoint = vi.fn().mockResolvedValue(undefined)

    const sn = StreamName.parse("Cat-stream")
    const mkBatch = (items: bigint[]): IngesterBatch => ({
      items: items.map((x) => [sn, mkEvent("Something", x)]),
      isTail: false,
      checkpoint: 1n,
      onComplete: checkpoint,
    })
    const batch1 = mkBatch([0n, 1n, 2n, 3n, 4n, 2n])
    const batch2 = mkBatch([5n, 3n, 6n, 1n, 7n, 3n])

    await sink.pump(batch1, ctrl.signal)
    if (waitBeforeMerge) await limiter.waitForEmpty()
    await sink.pump(batch2, ctrl.signal)

    await limiter.waitForEmpty()
    ctrl.abort()
    expect(invocations).toBe(waitBeforeMerge ? 2 : 1)
    expect(seen).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n])

    await sinkP
  }
  test("When merged before handling", () => runTest(false))

  test("When handled before merge", () => runTest(true))
})

describe("Handling gaps", () => {
  test("When disabled, gaps are ignored", async () => {
    let invocations = 0
    const ctrl = new AbortController()
    const seen: bigint[] = []

    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      for (const e of events) seen.push(e.index)

      await new Promise(setImmediate)
    }

    const limiter = new BatchLimiter(3)
    const sink = new StreamsSink(handler, 10, limiter)
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
    expect(invocations).toBe(2)
    expect(seen).toEqual([0n, 1n, 3n, 4n])

    await sinkP
  })

  test("When enabled, the missing event is waited on", async () => {
    let invocations = 0
    const ctrl = new AbortController()
    const seen: bigint[] = []

    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      for (const e of events) seen.push(e.index)

      await new Promise(setImmediate)
    }

    const limiter = new BatchLimiter(3)
    const sink = new StreamsSink(handler, 10, limiter, true)
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
    const batch2 = mkBatch([2n])

    await sink.pump(batch1, ctrl.signal)
    await setTimeout(10)
    expect(invocations).toBe(1)
    expect(seen).toEqual([0n, 1n])
    await sink.pump(batch2, ctrl.signal)

    await limiter.waitForEmpty()
    ctrl.abort()
    expect(invocations).toBe(2)
    expect(seen).toEqual([0n, 1n, 2n, 3n, 4n])

    await sinkP
  })
})

describe("StreamResult", () => {
  test("StreamResult.PartiallyProcessed Retries the stream with the rest of the events", async () => {
    let invocations = 0
    const eventCount: number[] = []
    const ctrl = new AbortController()

    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      eventCount.push(events.length)
      await new Promise(setImmediate)
      return StreamResult.PartiallyProcessed(2)
    }

    const limiter = new BatchLimiter(3)
    const sink = new StreamsSink(handler, 10, limiter)
    const sinkP = sink.start(ctrl.signal)

    const checkpoint = vi.fn().mockResolvedValue(undefined)

    const batch: IngesterBatch = {
      items: Array.from({ length: 10 }, (_, i) => [
        StreamName.parse("Cat-stream0"),
        mkEvent("Something", BigInt(i)),
      ]),
      isTail: false,
      checkpoint: 0n,
      onComplete: checkpoint,
    }

    // each mkBatch has 1 event in 10 streams
    await sink.pump(batch, ctrl.signal)

    await limiter.waitForEmpty()
    ctrl.abort()

    expect(invocations).toBe(5)
    expect(eventCount).toEqual([10, 8, 6, 4, 2])
    expect(checkpoint).toHaveBeenCalledTimes(1)
    await sinkP
  })

  test("OverrideNextIndex ignores intervening events", async () => {
    let invocations = 0
    const eventIndices: bigint[] = []
    const ctrl = new AbortController()

    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      for (const event of events) eventIndices.push(event.index)
      await new Promise(setImmediate)
      const ver = events[0].index + BigInt(events.length)
      if (ver < 20) return StreamResult.OverrideNextIndex(20n)
      return
    }

    const limiter = new BatchLimiter(3)
    const sink = new StreamsSink(handler, 10, limiter)
    const sinkP = sink.start(ctrl.signal)

    const checkpoint = vi.fn().mockResolvedValue(undefined)

    const batch = (from: number, count = 10): IngesterBatch => ({
      items: Array.from({ length: count }, (_, i) => [
        StreamName.parse("Cat-stream0"),
        mkEvent("Something", BigInt(from + i)),
      ]),
      isTail: false,
      checkpoint: BigInt(from + count),
      onComplete: checkpoint,
    })

    // each mkBatch has 1 event in 10 streams
    await sink.pump(batch(0), ctrl.signal)
    await limiter.waitForEmpty()
    await sink.pump(batch(10), ctrl.signal)
    await limiter.waitForEmpty()
    await sink.pump(batch(20, 2), ctrl.signal)
    await limiter.waitForEmpty()
    ctrl.abort()

    const expectedIndices = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 20n, 21n]
    expect(eventIndices).toEqual(expectedIndices)
    expect(invocations).toBe(2)
    expect(checkpoint).toHaveBeenCalledTimes(3)
    await sinkP
  })

  test("NoneProcessed will retry the stream", async () => {
    let invocations = 0
    const eventIndices: bigint[] = []
    const ctrl = new AbortController()

    let failedOnce = false
    async function handler(sn: StreamName, events: ITimelineEvent[]) {
      invocations++
      for (const event of events) eventIndices.push(event.index)
      await new Promise(setImmediate)
      if (!failedOnce) {
        failedOnce = true
        return StreamResult.NoneProcessed
      }
    }

    const limiter = new BatchLimiter(3)
    const sink = new StreamsSink(handler, 10, limiter)
    const sinkP = sink.start(ctrl.signal)

    const checkpoint = vi.fn().mockResolvedValue(undefined)

    const batch = (from: number, count = 10): IngesterBatch => ({
      items: Array.from({ length: count }, (_, i) => [
        StreamName.parse("Cat-stream0"),
        mkEvent("Something", BigInt(from + i)),
      ]),
      isTail: false,
      checkpoint: BigInt(from + count),
      onComplete: checkpoint,
    })

    // each mkBatch has 1 event in 10 streams
    await sink.pump(batch(0), ctrl.signal)
    await limiter.waitForEmpty()
    ctrl.abort()

    const expectedIndices = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]
    expect(eventIndices).toEqual(expectedIndices.concat(expectedIndices))
    expect(invocations).toBe(2)
    expect(checkpoint).toHaveBeenCalledTimes(1)
    await sinkP
  })
})
