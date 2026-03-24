import { Codec, Decider, StreamId } from "@equinox-js/core"
import { describe, expect, test } from "vitest"
import { MemoryStoreCategory, VolatileStore } from "../src/index.js"

describe("memory-store", () => {
  test("transactVersion returns the full stream version after multiple appends", async () => {
    type Event = { type: "Incremented"; data: { amount: number } }
    type State = { total: number }

    const codec = Codec.json<Event>()
    const initial: State = { total: 0 }
    const fold = (state: State, events: Event[]) => ({
      total: events.reduce((sum, event) => sum + event.data.amount, state.total),
    })

    const category = MemoryStoreCategory.create(
      new VolatileStore<string>(),
      "Counter",
      codec,
      fold,
      initial,
    )
    const streamId = StreamId.create("1")
    const decider = Decider.forStream(category, streamId, undefined)

    await expect(
      decider.transactVersion(() => [{ type: "Incremented", data: { amount: 1 } }]),
    ).resolves.toBe(1n)
    await expect(
      decider.transactVersion(() => [{ type: "Incremented", data: { amount: 1 } }]),
    ).resolves.toBe(2n)
  })
})
