import { test, expect } from "vitest"
import * as AppendsIndex from "./AppendsIndex"
import { AppendsEpochId, AppendsPartitionId, IndexStreamId } from "./Identifiers"
import * as AppendsEpoch from "./AppendsEpoch"
import * as ExactlyOnceIngester from "./ExactlyOnceIngester"
import { VolatileStore } from "@equinox-js/memory-store"

const createIngesterFactory = (store: VolatileStore<Buffer>, maxVersion = 5000n) => {
  const index = AppendsIndex.Service.createMem(store)
  const epochs = AppendsEpoch.Config.createMem(1024 * 1024, maxVersion, 100_000, store)
  return (partitionId: AppendsPartitionId) => {
    let readIngestionEpoch = () => index.readIngestionEpochId(partitionId)
    let markIngestionEpoch = (epochId: AppendsEpochId) =>
      index.markIngestionEpoch(partitionId, epochId)
    let ingest = (eid: AppendsEpochId, items: AppendsEpoch.Events.StreamSpan[]) =>
      epochs.ingest(partitionId, eid, items)
    return ExactlyOnceIngester.create(readIngestionEpoch, markIngestionEpoch, ingest, (s) => s)
  }
}

test("Basic ingestion", async () => {
  const store = new VolatileStore<Buffer>()
  const reader = AppendsEpoch.Reader.Config.createMem(store)
  const ingesterFactory = createIngesterFactory(store)
  const ingester = ingesterFactory(AppendsPartitionId.wellKnownId)
  await ingester.ingestMany(AppendsEpochId.initial, [
    { p: IndexStreamId.ofString("Cat-stream1"), i: 0, c: ["A", "B"] },
    { p: IndexStreamId.ofString("Cat-stream2"), i: 0, c: ["A", "B"] },
    { p: IndexStreamId.ofString("Cat-stream3"), i: 0, c: ["A", "B"] },
  ])
  const [, version, state] = await reader.read(
    AppendsPartitionId.wellKnownId,
    AppendsEpochId.initial,
    0n,
  )
  expect(version).toEqual(1n)
  expect(state).toEqual({
    closed: false,
    changes: [
      [
        0,
        [
          { c: ["A", "B"], i: 0, p: "Cat-stream1" },
          { c: ["A", "B"], i: 0, p: "Cat-stream2" },
          { c: ["A", "B"], i: 0, p: "Cat-stream3" },
        ],
      ],
    ],
  })
})

test("Reingesting the same values", async () => {
  const store = new VolatileStore<Buffer>()
  const reader = AppendsEpoch.Reader.Config.createMem(store)
  const ingesterFactory = createIngesterFactory(store)
  const ingester = ingesterFactory(AppendsPartitionId.wellKnownId)
  for (let i = 0; i < 10; ++i)
    await ingester.ingestMany(AppendsEpochId.initial, [
      { p: IndexStreamId.ofString("Cat-stream1"), i: 0, c: ["A", "B"] },
      { p: IndexStreamId.ofString("Cat-stream2"), i: 0, c: ["A", "B"] },
      { p: IndexStreamId.ofString("Cat-stream3"), i: 0, c: ["A", "B"] },
    ])
  const [, version, state] = await reader.read(
    AppendsPartitionId.wellKnownId,
    AppendsEpochId.initial,
    0n,
  )
  expect(version).toEqual(1n)
  expect(state).toEqual({
    closed: false,
    changes: [
      [
        0,
        [
          { c: ["A", "B"], i: 0, p: "Cat-stream1" },
          { c: ["A", "B"], i: 0, p: "Cat-stream2" },
          { c: ["A", "B"], i: 0, p: "Cat-stream3" },
        ],
      ],
    ],
  })
})

test("Reingesting the same values, and randomly an extra event", async () => {
  const store = new VolatileStore<Buffer>()
  const reader = AppendsEpoch.Reader.Config.createMem(store)
  const ingesterFactory = createIngesterFactory(store)
  const ingester = ingesterFactory(AppendsPartitionId.wellKnownId)
  for (let i = 0; i < 10; ++i)
    await ingester.ingestMany(AppendsEpochId.initial, [
      { p: IndexStreamId.ofString("Cat-stream1"), i: 0, c: ["A", "B"] },
      { p: IndexStreamId.ofString("Cat-stream2"), i: 0, c: ["A", "B"].concat(i % 2 ? ["C"] : []) },
      { p: IndexStreamId.ofString("Cat-stream3"), i: 0, c: ["A", "B"] },
    ])
  const [, version, state] = await reader.read(
    AppendsPartitionId.wellKnownId,
    AppendsEpochId.initial,
    0n,
  )
  expect(version).toEqual(2n)
  expect(state).toEqual({
    closed: false,
    changes: [
      [
        0,
        [
          { c: ["A", "B"], i: 0, p: "Cat-stream1" },
          { c: ["A", "B"], i: 0, p: "Cat-stream2" },
          { c: ["A", "B"], i: 0, p: "Cat-stream3" },
        ],
      ],
      [1, [{ c: ["C"], i: 2, p: "Cat-stream2" }]],
    ],
  })
})

test("Splits into epochs, duplication occurs across epochs", async () => {
  const store = new VolatileStore<Buffer>()
  const reader = AppendsEpoch.Reader.Config.createMem(store)
  const index = AppendsIndex.Reader.createMem(store)
  const ingesterFactory = createIngesterFactory(store, 2n)
  const ingester = ingesterFactory(AppendsPartitionId.wellKnownId)
  const ingest = async (spans: AppendsEpoch.Events.StreamSpan[]) =>
    ingester.ingestMany(await ingester.activeIngestionEpochId(), spans)
  for (let i = 0; i < 10; ++i) {
    await ingest([{ p: IndexStreamId.ofString("Cat-stream1"), i: 0, c: ["A", "B"] }])
    await ingest([{ p: IndexStreamId.ofString("Cat-stream2"), i: 0, c: ["A", "B"] }])
    await ingest([{ p: IndexStreamId.ofString("Cat-stream3"), i: 0, c: ["A", "B"] }])
    await ingest([{ p: IndexStreamId.ofString("Cat-stream4"), i: 0, c: ["A", "B"] }])
    await ingest([{ p: IndexStreamId.ofString("Cat-stream5"), i: 0, c: ["A", "B"] }])
  }

  const activeEpoch = await index.readIngestionEpochId(AppendsPartitionId.wellKnownId)
  expect(activeEpoch).toEqual(16)
  const changes: [AppendsEpochId, number, AppendsEpoch.Events.StreamSpan[]][] = []
  for (let i = 0; i <= activeEpoch; ++i) {
    const epochId = AppendsEpochId.parse(i.toString())
    const [, version, state] = await reader.read(AppendsPartitionId.wellKnownId, epochId, 0n)
    changes.push(...state.changes.map(([a, b]) => [epochId, a, b] as any))
    expect(version).toEqual(i < activeEpoch ? 4n : 2n)
    expect(state.closed).toBe(i < activeEpoch)
  }

  expect(changes).toMatchInlineSnapshot([
    [0, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [0, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [0, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [1, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [1, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [1, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [2, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [2, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [2, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [3, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [3, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [3, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [4, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [4, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [4, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [5, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [5, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [5, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [6, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [6, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [6, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [7, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [7, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [7, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [8, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [8, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [8, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [9, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [9, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [9, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [10, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [10, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [10, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [11, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [11, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [11, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [12, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [12, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [12, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [13, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [13, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [13, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [14, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [14, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [14, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
    [15, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream1" }]],
    [15, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream2" }]],
    [15, 2, [{ c: ["A", "B"], i: 0, p: "Cat-stream3" }]],
    [16, 0, [{ c: ["A", "B"], i: 0, p: "Cat-stream4" }]],
    [16, 1, [{ c: ["A", "B"], i: 0, p: "Cat-stream5" }]],
  ])
})
