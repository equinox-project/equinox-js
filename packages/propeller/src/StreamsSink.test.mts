import { describe, test, expect, vi } from "vitest"
import { BatchLimiter, StreamsSink } from "./StreamsSink.mjs"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"
import { sleep } from "./Sleep.js"
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

      sink.start(ctrl.signal).catch(() => {})

      await sink.pump(
        mkBatch(() => {}),
        ctrl.signal,
      )

      await limiter.waitForEmpty()
      ctrl.abort()

      expect(maxActive).toBe(concurrency)
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

  sink.start(ctrl.signal).catch(() => {})

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(2)
})

const mkSingleBatch = (
  onComplete: (n: bigint) => () => Promise<void>,
  checkpoint: bigint,
): IngesterBatch => ({
  items: [[StreamName.create("Cat", StreamId.create("stream1")), mkEvent("Something", 0n)]],
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

  sink.start(ctrl.signal).catch(() => {})
  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  // First batch will be immediately picked up
  await sink.pump(mkSingleBatch(complete, 0n), ctrl.signal)
  // meanwhile we merge two batches together
  await sink.pump(mkSingleBatch(complete, 1n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 2n), ctrl.signal)

  // This batch will be immediately picked up
  await sink.pump(mkSingleBatch(complete, 3n), ctrl.signal)
  // meanwhile we merge two batches together
  await sink.pump(mkSingleBatch(complete, 4n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 5n), ctrl.signal)

  await limiter.waitForEmpty()
  ctrl.abort()

  expect(invocations).toBe(4)

  // onComplete is called in order and for every batch
  expect(completed.mock.calls).toEqual([[0n], [1n], [2n], [3n], [4n], [5n]])
})
