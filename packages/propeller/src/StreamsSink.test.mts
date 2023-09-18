import { describe, test, expect, vi, Mock } from "vitest"
import { StreamsSink } from "./StreamsSink.mjs"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"
import { sleep } from "./Sleep.js"
import { IngesterBatch } from "./Types.js"
import { MemoryCheckpoints } from "./Checkpoints.js"

describe("Concurrency", () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "Correctly limits concurrency to %d",
    async (concurrency) => {
      const active = new Set<string>()
      let maxActive = 0
      const ctrl = new AbortController()
      async function handler(stream: StreamName, events: ITimelineEvent[]) {
        active.add(stream)
        maxActive = Math.max(maxActive, active.size)
        await new Promise(setImmediate)
        active.delete(stream)
      }
      const sink = new StreamsSink(handler, concurrency, 1)

      sink.start(ctrl.signal)

      await sink.pump(
        {
          items: Array.from({ length: 10 }).map((_, i): [StreamName, ITimelineEvent] => [
            StreamName.create("Cat", StreamId.create("stream" + i)),
            {
              id: "",
              time: new Date(),
              isUnfold: false,
              size: 0,
              type: "Something",
              index: BigInt(i),
            },
          ]),
          isTail: false,
          checkpoint: 5n,
          onComplete: () => Promise.resolve(),
        },
        ctrl.signal,
      )

      await new Promise(setImmediate)
      ctrl.abort()

      expect(maxActive).toBe(concurrency)
    },
  )
})

const mkBatch = (checkpoint: Mock, index: bigint): IngesterBatch => ({
  items: Array.from({ length: 10 }).map((_, i): [StreamName, ITimelineEvent] => [
    StreamName.create("Cat", StreamId.create("stream" + i)),
    {
      id: "",
      time: new Date(),
      isUnfold: false,
      size: 0,
      type: "Something",
      index,
    },
  ]),
  isTail: false,
  checkpoint: 5n * index,
  onComplete: checkpoint,
})

test("Correctly merges batches", async () => {
  let invocations = 0
  const ctrl = new AbortController()
  async function handler(stream: StreamName, events: ITimelineEvent[]) {
    invocations++
    await new Promise(setImmediate)
  }
  const sink = new StreamsSink(handler, 10, 2)

  sink.start(ctrl.signal)
  const checkpoint = vi.fn().mockResolvedValue(undefined)

  await sink.pump(mkBatch(checkpoint, 0n), ctrl.signal)
  await sink.pump(mkBatch(checkpoint, 1n), ctrl.signal)

  await sleep(0, ctrl.signal)
  ctrl.abort()

  expect(invocations).toBe(10)
  expect(checkpoint).toHaveBeenCalledTimes(2)
})

const mkSingleBatch = (
  checkpoint: (n: bigint) => () => Promise<void>,
  index: bigint,
): IngesterBatch => ({
  items: [
    [
      StreamName.create("Cat", StreamId.create("stream1")),
      {
        id: "",
        time: new Date(),
        isUnfold: false,
        size: 0,
        type: "Something",
        index,
      },
    ],
  ],
  isTail: false,
  checkpoint: index,
  onComplete: checkpoint(index),
})

test("Correctly limits in-flight batches", async () => {
  let invocations = 0
  const ctrl = new AbortController()
  async function handler(stream: StreamName, events: ITimelineEvent[]) {
    invocations++
    await new Promise(setImmediate)
  }
  const sink = new StreamsSink(handler, 10, 2)

  sink.start(ctrl.signal)
  const checkpoints = new MemoryCheckpoints()
  vi.spyOn(checkpoints, "commit")
  const checkpoint = (n: bigint) => () => checkpoints.commit("123", "Test", n)

  await sink.pump(mkSingleBatch(checkpoint, 0n), ctrl.signal)
  await sink.pump(mkSingleBatch(checkpoint, 1n), ctrl.signal)
  await sink.pump(mkSingleBatch(checkpoint, 2n), ctrl.signal)
  await sink.pump(mkSingleBatch(checkpoint, 3n), ctrl.signal)
  await sink.pump(mkSingleBatch(checkpoint, 4n), ctrl.signal)

  await sleep(0, ctrl.signal)
  ctrl.abort()

  expect(invocations).toBe(3)
  expect(checkpoints.commit).toHaveBeenCalledTimes(5)
  expect(checkpoints.commit).toHaveBeenLastCalledWith("123", "Test", 4n)
})
