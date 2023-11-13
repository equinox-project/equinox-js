import { MemoryCheckpoints } from "./Checkpoints.js"
import { CheckpointWriter, TailingFeedSource } from "./FeedSource.mjs"
import { test, expect, vi } from "vitest"
import { Batch, IngesterBatch, Sink } from "./Types.js"
import { StreamName, StreamId } from "@equinox-js/core"
import { sleep } from "./Sleep.js"

class MemorySink implements Sink {
  async start() {}

  async pump(batch: IngesterBatch, signal: AbortSignal): Promise<void> {
    batch.onComplete()
  }
  addTracingAttrs = vi.fn()
}

const throwIfActive = (signal: AbortSignal) => (e: unknown) => {
  if (!signal.aborted) throw e
}

function createCrawl(batches: Batch[]) {
  return async function* crawl(): AsyncIterable<Batch> {
    while (batches.length) {
      yield batches.shift()!
    }
  }
}

const streamName = (id: string) => StreamName.create("Cat", StreamId.create(id))

const checkpointCrawl = () =>
  createCrawl([
    {
      items: [
        [streamName("1"), {} as any],
        [streamName("2"), {} as any],
      ],
      checkpoint: 0n,
      isTail: false,
    },
    {
      items: [
        [streamName("3"), {} as any],
        [streamName("4"), {} as any],
      ],
      checkpoint: 1n,
      isTail: false,
    },
    {
      items: [
        [streamName("5"), {} as any],
        [streamName("6"), {} as any],
      ],
      checkpoint: 2n,
      isTail: false,
    },
    {
      items: [
        [streamName("7"), {} as any],
        [streamName("8"), {} as any],
      ],
      checkpoint: 3n,
      isTail: true,
    },
  ])

test("Checkpointing happens asynchronously", async () => {
  const checkpoints = new MemoryCheckpoints()
  const sink = new MemorySink()
  const crawl = checkpointCrawl()

  const ctrl = new AbortController()
  const checkpointReached = checkpoints.waitForCheckpoint("TestGroup", "0", 3n)
  const source = new TailingFeedSource({
    tailSleepIntervalMs: 1000,
    checkpointIntervalMs: 10,
    groupName: "TestGroup",
    checkpoints,
    sink,
    crawl,
  })
  vi.spyOn(checkpoints, "commit")
  const oldFlush = CheckpointWriter.prototype.flush
  CheckpointWriter.prototype.flush = async function () {
    await sleep(10, ctrl.signal)
    await oldFlush.call(this)
  }
  vi.spyOn(CheckpointWriter.prototype, "flush")
  expect(await checkpoints.load("TestGroup", "0")).toBe(0n)
  const sourceP = source.start("0", ctrl.signal).catch(throwIfActive(ctrl.signal))
  await checkpointReached
  expect(CheckpointWriter.prototype.flush).toHaveBeenCalledTimes(1)
  expect(checkpoints.commit).toHaveBeenCalledTimes(1)
  ctrl.abort()
  expect(await checkpoints.load("TestGroup", "0")).toBe(3n)
  await sourceP
  expect(CheckpointWriter.prototype.flush).toHaveBeenCalledTimes(2)
})
