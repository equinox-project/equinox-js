import { describe, test, expect } from "vitest"
import { Config, Store } from "../src/config/equinox.js"
import { VolatileStore } from "@equinox-js/memory-store"
import * as GroupCheckoutProcessor from "../src/reactor/GroupCheckoutProcessor.js"
import { GroupCheckout, GuestStay } from "../src/domain/index.js"
import { GroupCheckoutId, PaymentId } from "../src/domain/Types.js"
import { randomStays } from "./Utils.js"

describe("GroupCheckoutFlow", () => {
  test(
    "Happy path",
    async () => {
      const store = new VolatileStore<string>()
      const config: Config = { store: Store.Memory, context: store }
      const stayService = GuestStay.Service.create(config)
      const groupCheckout = GroupCheckout.Service.create(config)
      const processor = new GroupCheckoutProcessor.Service(stayService, groupCheckout, 2)
      const groupCheckoutId = GroupCheckoutId.create()
      const paymentId = PaymentId.create()
      const stays = randomStays()
      let charged = 0
      for (const { stayId, chargeId, amount } of stays) {
        charged += amount
        await stayService.charge(stayId, chargeId, amount)
      }
      const stayIds = stays.map((s) => s.stayId)

      const result = await groupCheckout.merge(groupCheckoutId, stayIds)

      switch (result.type) {
        // No stays were added
        case "Ready": {
          if (result.balance !== 0) throw new Error("Balance should be 0")
          expect(stayIds).toEqual([])
          // We'll run the reactor, but just to ensure it's a no-op
          const version = await processor.react(groupCheckoutId)
          expect(version).toEqual(0n)
          break
        }
        // If any stays have been added, they should be recorded, and work should be triggered
        case "MergeStays": {
          expect(result.stays).toEqual(stayIds)
          const version = await processor.react(groupCheckoutId)
          const state = await groupCheckout.readResult(groupCheckoutId)
          expect(state).toEqual({ ok: stayIds.length, failed: 0 })
          expect(version).toEqual(1n)
          break
        }
        default:
          // This should never happen
          expect(result).toBeNull()
      }

      await groupCheckout.pay(groupCheckoutId, paymentId, charged)
      await groupCheckout.confirm(groupCheckoutId)
      const next = await groupCheckout.read(groupCheckoutId)
      expect(next.type).toEqual("Finished")
    },
    { repeats: 10 },
  )
})
