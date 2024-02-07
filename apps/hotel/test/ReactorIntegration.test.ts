import { describe, test } from "vitest"
import { Config } from "../src/config/equinox.js"
import { GroupCheckout, GuestStay } from "../src/domain/index.js"
import { createSink } from "../src/reactor/Handler.js"
import { createConfig, createSource } from "../src/entrypoints/config.js"
import { randomUUID } from "crypto"
import { GroupCheckoutId, PaymentId } from "../src/domain/Types.js"
import { randomStays } from "./Utils.js"

async function runScenario(config: Config, payBefore: boolean, propagationDelay = 0) {
  const staysService = GuestStay.Service.create(config)
  const checkoutService = GroupCheckout.Service.create(config)
  const sink = createSink(config)
  const source = createSource(config, {
    sink,
    categories: [GroupCheckout.Stream.category],
    groupName: randomUUID().replace(/-/g, ""),
    tailSleepIntervalMs: 100,
  })
  const ctrl = new AbortController()
  const srcP = source.start(ctrl.signal)
  const groupCheckoutId = GroupCheckoutId.create()
  const stays = randomStays()
  let charged = 0
  for (const { stayId, chargeId, amount } of stays) {
    charged += amount
    await staysService.charge(stayId, chargeId, amount)
  }
  if (payBefore) await checkoutService.pay(groupCheckoutId, PaymentId.create(), charged)
  const stayIds = stays.map((s) => s.stayId)

  await checkoutService.merge(groupCheckoutId, stayIds)
  await source.stats.waitForTail(propagationDelay)
  const result = await checkoutService.confirm(groupCheckoutId)

  switch (result.type) {
    case "Ok":
      break
    case "Processing":
      throw new Error("Unexpected Processing")
    case "BalanceOutstanding":
      if (payBefore) throw new Error("Unexpected BalanceOutstanding")
  }
  if (!payBefore) {
    await checkoutService.pay(groupCheckoutId, PaymentId.create(), charged)
    const result = await checkoutService.confirm(groupCheckoutId)
    switch (result.type) {
      case "Ok":
        break
      case "Processing":
      case "BalanceOutstanding":
        throw new Error("Checkout not complete")
    }
  }
  ctrl.abort()
  await srcP
}

// TODO: implement a MemoryStoreSource
describe.skip("Memory")
// TODO: implement in a CI friendly way
describe.skip("Dynamo", () => {
  const config = createConfig("dynamo")
  const propagationDelay = 600
  test("Pay before", () => runScenario(config, true, propagationDelay))
  test("Pay after", () => runScenario(config, false, propagationDelay))
})
describe("MessageDB", () => {
  const config = createConfig("message-db")
  test("Pay before", () => runScenario(config, true))
  test("Pay after", () => runScenario(config, false))
})
