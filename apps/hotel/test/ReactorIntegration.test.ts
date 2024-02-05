import { vi, describe, test } from "vitest"
import { Config } from "../src/config/equinox.js"
import { GroupCheckout, GuestStay } from "../src/domain/index.js"
import { createSink } from "../src/reactor/Handler.js"
import { createConfig, createSource, leaderPool } from "../src/entrypoints/config.js"
import { randomUUID } from "crypto"
import { GroupCheckoutId, PaymentId } from "../src/domain/Types.js"
import { randomStays } from "./Utils.js"
import EventEmitter from "events"
import { Stats } from "@equinox-js/propeller"

function waitForEvent(emitter: EventEmitter, event: string, pred: (...args: any[]) => boolean) {
  return new Promise((resolve) => {
    const onEvent = (...args: any[]) => {
      if (pred(...args)) {
        emitter.off(event, onEvent)
        resolve(true)
      }
    }
    emitter.on(event, onEvent)
  })
}

async function runScenario(
  config: Config,
  payBefore: boolean,
  wait: (stats: Stats, id: GroupCheckoutId) => Promise<void>,
) {
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
  source.start(ctrl.signal)
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
  await wait(source.stats, groupCheckoutId)
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
}

// TODO: implement a MemoryStoreSource
describe.skip("Memory")
// TODO: implement in a CI friendly way
describe.skip("Dynamo", () => {
  const config = createConfig("dynamo")
  const wait = async (stats: Stats, id: GroupCheckoutId) => {
    const expectedStream = GroupCheckout.Stream.name(id)
    await waitForEvent(stats, "completed", (x) => x.streams.has(expectedStream))
  }
  test("Pay before", () => runScenario(config, true, wait))
  test("Pay after", () => runScenario(config, false, wait))
})
describe("MessageDB", () => {
  const config = createConfig("message-db")
  const wait = async (stats: Stats) => {
    const {
      rows: [{ checkpoint }],
    } = await leaderPool().query(
      `select max(global_position) as checkpoint from messages where category(stream_name) = $1`,
      [GroupCheckout.Stream.category],
    )
    await waitForEvent(stats, "completed", (x) => x.checkpoint >= checkpoint)
  }
  test("Pay before", () => runScenario(config, true, wait))
  test("Pay after", () => runScenario(config, false, wait))
})
