import * as Handler from "../reactor/Handler.js"
import { GroupCheckout } from "../domain/index.js"
import { createConfig, createSource, endPools } from "./config.js"

const config = createConfig()

const sink = Handler.createSink(config)

const source = createSource(config, {
  sink,
  tailSleepIntervalMs: 1000,
  groupName: "GroupCheckoutProcessor",
  categories: [GroupCheckout.Stream.category],
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

source.start(ctrl.signal).finally(() => endPools())
