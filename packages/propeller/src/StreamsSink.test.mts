import { describe, test, expect } from "vitest"
import { StreamsSink } from "./StreamsSink.mjs"
import { ITimelineEvent, StreamId, StreamName } from "@equinox-js/core"

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
        await new Promise(process.nextTick)
        active.delete(stream)
      }
      const sink = new StreamsSink(handler, concurrency)

      await sink.pump({
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
      })

      expect(maxActive).toBe(concurrency)
    },
  )
})
