import { afterAll, beforeAll, describe, test } from "vitest"
import { Config, Store } from "../src/config/equinox.js"
import { GroupCheckout, GuestStay } from "../src/domain/index.js"
import { createSink } from "../src/reactor/Handler.js"
import { createConfig, createSource } from "../src/entrypoints/config.js"
import { randomUUID } from "crypto"
import { GroupCheckoutId, PaymentId } from "../src/domain/Types.js"
import { startLocalDynamoIndexer, createTable, localDynamoConfig, randomStays } from "./Utils.js"
import { MemoryCache } from "@equinox-js/core"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import {
  QueryOptions,
  TipOptions,
  DynamoStoreClient,
  DynamoStoreContext,
} from "@equinox-js/dynamo-store"
import { DynamoCheckpoints, DynamoStoreSource, LoadMode } from "@equinox-js/dynamo-store-source"

async function runScenario(
  config: Config,
  payBefore: boolean,
  createSource: CreateSource,
  propagationDelay = 0,
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

type CreateSource = typeof createSource
describe("Dynamo", () => {
  const ddb = new DynamoDB(localDynamoConfig)
  const client = new DynamoStoreClient(ddb)
  const suffix = randomUUID().replace(/-/g, "")
  const tableName = `hotel-events-${suffix}`
  const indexTableName = `hotel-events-index-${suffix}`
  let indexer!: { stop: () => Promise<void> }
  beforeAll(async () => {
    await createTable(ddb, tableName, true)
    await createTable(ddb, indexTableName, false)
    indexer = await startLocalDynamoIndexer(tableName, indexTableName)
  })
  afterAll(async () => {
    await indexer.stop()
    await Promise.all([
      ddb.deleteTable({ TableName: tableName }).catch(() => undefined),
      ddb.deleteTable({ TableName: indexTableName }).catch(() => undefined),
    ])
  })
  const config: Config = {
    store: Store.Dynamo,
    context: new DynamoStoreContext({
      client,
      tableName,
      tip: TipOptions.create({}),
      query: QueryOptions.create({}),
    }),
    cache: new MemoryCache(),
  }
  const indexContext = new DynamoStoreContext({
    client,
    tableName: indexTableName,
    tip: TipOptions.create({}),
    query: QueryOptions.create({}),
  })

  const createSource: CreateSource = (config, opts) => {
    if (config.store !== Store.Dynamo) throw new Error("Unexpected store")
    const checkpoints = DynamoCheckpoints.create(config.context, config.cache, 100)
    return DynamoStoreSource.create({
      mode: LoadMode.IndexOnly(),
      context: indexContext,
      batchSizeCutoff: 500,
      sink: opts.sink,
      checkpoints,
      categories: opts.categories,
      groupName: opts.groupName,
      tailSleepIntervalMs: opts.tailSleepIntervalMs,
    })
  }

  test("Pay before", { timeout: 15_000 }, () => runScenario(config, true, createSource, 200))
  test("Pay after", { timeout: 15_000 }, () => runScenario(config, false, createSource, 200))
})
describe("MessageDB", () => {
  const config = createConfig("message-db")
  test("Pay before", () => runScenario(config, true, createSource))
  test("Pay after", () => runScenario(config, false, createSource))
})
