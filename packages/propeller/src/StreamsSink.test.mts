import { describe, test, expect, vi } from "vitest"
import { StreamsSink } from "./StreamsSink.mjs"
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
      const sink = new StreamsSink(handler, concurrency, 1)

      sink.start(ctrl.signal).catch(() => {})

      await sink.pump(
        mkBatch(() => {}),
        ctrl.signal,
      )

      await new Promise(setImmediate)
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
  const sink = new StreamsSink(handler, 10, 2)

  const checkpoint = vi.fn().mockResolvedValue(undefined)

  sink.start(ctrl.signal).catch(() => {})
  // each mkBatch has 1 event in 10 streams
  await sink.pump(mkBatch(checkpoint, 0n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n), ctrl.signal)

  // sleep triggers after setImmediate
  await sleep(0, ctrl.signal)
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
    await new Promise(setImmediate)
  }
  const sink = new StreamsSink(handler, 10, 2)

  sink.start(ctrl.signal).catch(() => {})
  const completed = vi.fn().mockResolvedValue(undefined)
  const complete = (n: bigint) => () => completed(n)

  await sink.pump(mkSingleBatch(complete, 0n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 1n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 2n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 3n), ctrl.signal)
  await sink.pump(mkSingleBatch(complete, 4n), ctrl.signal)

  await sleep(0, ctrl.signal)
  ctrl.abort()

  expect(invocations).toBe(3)

  // onComplete is called in order and for every batch
  expect(completed).toHaveBeenCalledTimes(5)
  expect(completed.mock.calls).toEqual([[0n], [1n], [2n], [3n], [4n]])
})
