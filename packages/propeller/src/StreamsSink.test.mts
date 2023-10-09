import { describe, test, expect, vi } from "vitest"
import { BatchLimiter, StreamsSink } from "./StreamsSink.mjs"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"
import { IngesterBatch } from "./Types.js"

const mkEvent = (type: string, index: bigint): ITimelineEvent => ({
  id: "",
  time: new Date(),
  isUnfold: false,
  size: 0,
  type,
  index,
})

const mkBatch = (onComplete: () => void, index?: bigint): IngesterBatch => ({
  items: Array.from({ length: 10 }).map((_, i): [StreamName, ITimelineEvent] => [
    StreamName.create("Cat", StreamId.create("stream" + i)),
    mkEvent("Something", index ?? BigInt(i)),
  ]),
  isTail: false,
  checkpoint: 5n,
  onComplete,
})

const abortsOrResolves = async (p: Promise<void>) => {
  const result = await p.then(
    () => "resolved",
    (err) => (err.name === "AbortError" ? "aborted" : "rejected"),
  )
  expect(result).toEqual(expect.stringMatching(/aborted|resolved/))
}

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
      await abortsOrResolves(sinkP)
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

  const checkpoint = vi.fn().mockResolvedValue(undefined)

  // each mkBatch has 1 event in 10 streams
  await sink.pump(mkBatch(checkpoint, 0n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n), ctrl.signal)

  const sinkP = sink.start(ctrl.signal)

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(2)
  await abortsOrResolves(sinkP)
})

const mkSingleBatch = (
  onComplete: (n: bigint) => () => Promise<void>,
  checkpoint: bigint,
): IngesterBatch => ({
  items: [[StreamName.create("Cat", StreamId.create("stream1")), mkEvent("Something", checkpoint)]],
  isTail: false,
  checkpoint: checkpoint,
  onComplete: onComplete(checkpoint),
})

test("Correctly limits in-flight batches", async () => {
  let invocations = 0
  const ctrl = new AbortController()
  async function handler() {
    invocations++
    await new Promise((res) => setTimeout(res, 10))
  }
  const limiter = new BatchLimiter(3)
  const sink = new StreamsSink(handler, 1, limiter)

  const sinkP = sink.start(ctrl.signal)
  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  // First two batches are picked up together
  await sink.pump(mkSingleBatch(complete, 0n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 1n), ctrl.signal)
  // This batch will be picked up after the first two complete
  await sink.pump(mkSingleBatch(complete, 2n), ctrl.signal)

  // after which we load up the next three and handle them together
  await sink.pump(mkSingleBatch(complete, 3n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 4n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 5n), ctrl.signal)

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(3)

  // onComplete is called in order and for every batch
  expect(completed.mock.calls).toEqual([[0n], [1n], [2n], [3n], [4n], [5n]])
  await abortsOrResolves(sinkP)
})

test("Ensures at-most one handler is per stream", async () => {
  let active = 0
  let maxActive = 0
  let invocations = 0
  const ctrl = new AbortController()
  async function handler() {
    invocations++
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((res) => setTimeout(res, 10))
    active--
  }
  const limiter = new BatchLimiter(6)
  const sink = new StreamsSink(handler, 100, limiter)

  const sinkP = sink.start(ctrl.signal)

  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  for (let i = 0; i < 10; ++i) {
    await sink.pump(mkSingleBatch(complete, BigInt(i)), ctrl.signal)
  }

  await limiter.waitForEmpty()
  ctrl.abort()

  // 1 invocation for the first pump, the other 5 are merged
  expect(invocations).toBe(2)
  expect(maxActive).toBe(1)

  // onComplete is called in order and for every batch
  expect(completed.mock.calls).toEqual(Array.from({ length: 10 }).map((_, i) => [BigInt(i)]))
  await abortsOrResolves(sinkP)
})
