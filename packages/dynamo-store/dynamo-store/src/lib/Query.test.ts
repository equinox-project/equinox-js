import { describe, expect, test } from "vitest"
import * as Query from "./Query.js"
import * as Position from "./Position.js"
import { Batch } from "./Batch.js"
import { Event } from "./Event.js"
import { ofBufferAndEncoding } from "./InternalBody.js"
import { randomUUID } from "crypto"

describe("Query.scanTip", () => {
  test('When an origin event exists in the tip it is "found"', async () => {
    await expect(
      Query.scanTip(
        () => ({ event: true }),
        () => true,
        { position: Position.null_(0n), index: 0n, events: [{ data: {}, meta: {} } as any] }
      )
    ).resolves.toEqual({
      found: true,
      events: [{ event: true }],
      maybeTipPos: Position.null_(0n),
      minIndex: 0n,
      next: 1n,
    })
  })
  test("When an origin event does not exists it's not 'found'", async () => {
    await expect(
      Query.scanTip(
        () => ({ event: true }),
        () => false,
        { position: Position.null_(0n), index: 0n, events: [{ data: {}, meta: {} } as any] }
      )
    ).resolves.toEqual({
      found: false,
      events: [{ event: true }],
      maybeTipPos: Position.null_(0n),
      minIndex: 0n,
      next: 1n,
    })
  })
})

const encode = (x: any) => ofBufferAndEncoding(new Uint8Array(Buffer.from(JSON.stringify(x))))

const mkEvent = (index: bigint): Event => ({
  index,
  type: "Type",
  data: encode({ hello: "world" }),
  meta: encode({ some: "meta" }),
  timestamp: new Date("2023-01-01T00:00:00.000Z"),
})

// It's important to note that the values defined on this
// example batch will have no effect on the processing of `Query.load`
// because it relies on the `ScanResult<T>` coming from `Query.scanTip`
// which is derived from the batch.
const ExampleTip: Batch = {
  bytes: 0,
  events: [mkEvent(1n)],
  etag: randomUUID(),
  version: 1n,
  streamName: "Test-1234",
  unfolds: [],
  index: 1n,
}

describe("Query.load", () => {
  test("When the tip is enough", async () => {
    const [pos, events] = await Query.load(
      0n,
      1000n,
      { found: true, next: 1n, minIndex: 0n, maybeTipPos: Position.fromTip(ExampleTip), events: ExampleTip.events },
      () =>
        Promise.resolve({
          found: false,
          minIndex: 0n,
          next: 0n,
          maybeTipPos: undefined,
          events: [],
        }),
      () => Promise.resolve(undefined)
    )
    expect(pos).toEqual(Position.fromTip(ExampleTip))
    expect(events).toEqual([ExampleTip.events[0]])
  })
  test("When the tip is not enough", async () => {
    const [pos, events] = await Query.load(
      undefined,
      undefined,
      // A minIndex of 5 indicates that there are 5 elements in preceding batches
      { found: false, next: 1n, minIndex: 5n, maybeTipPos: Position.fromTip(ExampleTip), events: [mkEvent(5n)] },
      () =>
        Promise.resolve({
          found: false,
          minIndex: 0n,
          next: 0n,
          maybeTipPos: undefined,
          events: [0n, 1n, 2n, 3n, 4n].map(mkEvent),
        }),
      () => Promise.resolve(undefined)
    )
    expect(pos).toEqual(Position.fromTip(ExampleTip))
    expect(events).toEqual([0n, 1n, 2n, 3n, 4n, 5n].map(mkEvent))
  })

  test("When the fallback is necessary but we're okay with missing events", async () => {
    const [pos, events] = await Query.load(
      undefined,
      undefined,
      // A minIndex of 5 indicates that there are 5 elements in preceding batches
      { found: false, next: 3n, minIndex: 5n, maybeTipPos: Position.fromTip(ExampleTip), events: [mkEvent(5n)] },
      () =>
        Promise.resolve({
          found: false,
          minIndex: 3n,
          next: 0n,
          maybeTipPos: undefined,
          events: [3n, 4n].map(mkEvent),
        }),
      true
    )
    expect(pos).toEqual(Position.fromTip(ExampleTip))
    expect(events).toEqual([3n, 4n, 5n].map(mkEvent))
  })

  test("When the fallback is necessary but we're not okay with missing events", async () => {
    await expect(
      Query.load(
        undefined,
        undefined,
        // A minIndex of 5 indicates that there are 5 elements in preceding batches
        { found: false, next: 3n, minIndex: 5n, maybeTipPos: Position.fromTip(ExampleTip), events: [mkEvent(5n)] },
        () =>
          Promise.resolve({
            found: false,
            minIndex: 3n,
            next: 0n,
            maybeTipPos: undefined,
            events: [3n, 4n].map(mkEvent),
          }),
        false
      )
    ).rejects.toThrow("Origin event not found; no Archive Table supplied")
  })

  test("When the fallback is necessary and we've set up an archive table", async () => {
    const [pos, events] = await Query.load(
      undefined,
      undefined,
      // A minIndex of 5 indicates that there are 5 elements in preceding batches
      { found: false, next: 3n, minIndex: 5n, maybeTipPos: Position.fromTip(ExampleTip), events: [mkEvent(5n)] },
      () =>
        Promise.resolve({
          found: false,
          minIndex: 3n,
          next: 0n,
          maybeTipPos: undefined,
          events: [3n, 4n].map(mkEvent),
        }),
      () =>
        Promise.resolve({
          found: false,
          minIndex: 0n,
          next: 0n,
          maybeTipPos: undefined,
          events: [0n, 1n, 2n].map(mkEvent),
        })
    )
    expect(pos).toEqual(Position.fromTip(ExampleTip))
    expect(events).toEqual([0n, 1n, 2n, 3n, 4n, 5n].map(mkEvent))
  })
})
