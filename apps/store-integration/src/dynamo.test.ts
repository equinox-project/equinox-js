import * as Cart from "./domain/Cart.js"
import * as ContactPreferences from "./domain/ContactPreferences.js"
import {
  Decider,
  MemoryCache,
  Codec,
  CachingStrategy,
  Tags,
  StreamId,
  ICache,
} from "@equinox-js/core"
import { describe, test, expect, afterEach, afterAll, beforeAll } from "vitest"
import { randomUUID } from "crypto"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import {
  AccessStrategy,
  DynamoStoreCategory,
  DynamoStoreClient,
  DynamoStoreContext,
  TipOptions,
  QueryOptions,
} from "@equinox-js/dynamo-store"
import { DynamoDB } from "@aws-sdk/client-dynamodb"

const Category = DynamoStoreCategory

const defaultBatchSize = 500

namespace CartService {
  type E = Cart.Events.Event
  type S = Cart.Fold.State
  const codec = Codec.deflate(Cart.Events.codec)
  const fold = Cart.Fold.fold
  const initial = Cart.Fold.initial
  const cache = new MemoryCache()
  const noCache = CachingStrategy.NoCache()

  export function createWithoutOptimization(context: DynamoStoreContext) {
    const category = Category.create(
      context,
      Cart.Category,
      codec,
      fold,
      initial,
      noCache,
      AccessStrategy.Unoptimized(),
    )
    return Cart.Service.create(category)
  }

  export function createWithSnapshotStrategy(context: DynamoStoreContext) {
    const access = AccessStrategy.Snapshot<E, S>(Cart.Fold.isOrigin, Cart.Fold.snapshot)
    const category = Category.create(context, Cart.Category, codec, fold, initial, noCache, access)
    return Cart.Service.create(category)
  }

  const caching = CachingStrategy.Cache(cache)

  export function createWithCaching(context: DynamoStoreContext) {
    const access = AccessStrategy.Unoptimized()
    const category = Category.create(context, Cart.Category, codec, fold, initial, caching, access)
    return Cart.Service.create(category)
  }

  export function createWithSnapshotStrategyAndCaching(context: DynamoStoreContext) {
    const access = AccessStrategy.Snapshot<E, S>(Cart.Fold.isOrigin, Cart.Fold.snapshot)
    const category = Category.create(context, Cart.Category, codec, fold, initial, caching, access)
    return Cart.Service.create(category)
  }
}
const ddb = new DynamoDB({
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  endpoint: "http://127.0.0.1:4566",
})
beforeAll(async () => {
  try {
    await ddb.describeTable({
      TableName: "test_events",
    })
  } catch (err) {
    console.log("Table does not exists. Creating")
    await ddb.createTable({
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "p", AttributeType: "S" },
        { AttributeName: "i", AttributeType: "N" },
      ],
      TableName: "test_events",
      KeySchema: [
        { AttributeName: "p", KeyType: "HASH" },
        { AttributeName: "i", KeyType: "RANGE" },
      ],
    })
  }
})

const client = new DynamoStoreClient(ddb)

const createContext = (connection: DynamoStoreClient, batchSize: number) =>
  new DynamoStoreContext({
    client: connection,
    tableName: "test_events",
    tip: TipOptions.create({ maxEvents: batchSize }),
    query: QueryOptions.create({ maxItems: batchSize }),
  })

namespace SimplestThing {
  export type Event = { type: "StuffHappened" }
  export const codec = Codec.json<Event>()
  export const evolve = (_state: Event, event: Event) => event
  export const initial: Event = { type: "StuffHappened" }
  export const fold = (_state: Event, events: Event[]) => events.reduce(evolve, initial)
  export const categoryName = "SimplestThing"
  export const resolve = (
    context: DynamoStoreContext,
    categoryName: string,
    streamId: StreamId,
  ) => {
    const caching = CachingStrategy.NoCache()
    const access = AccessStrategy.Unoptimized()
    // prettier-ignore
    const category = Category.create(context, categoryName, Codec.deflate(codec), fold, initial, caching, access)
    return Decider.forStream(category, streamId, undefined)
  }
}

namespace ContactPreferencesService {
  const { fold, initial, codec } = ContactPreferences

  export const createService = (client: DynamoStoreClient, cache?: ICache) => {
    const context = createContext(client, defaultBatchSize)
    const category = Category.create(
      context,
      ContactPreferences.Category,
      Codec.deflate(codec),
      fold,
      initial,
      cache ? CachingStrategy.Cache(cache) : CachingStrategy.NoCache(),
      AccessStrategy.LatestKnownEvent(),
    )
    return ContactPreferences.Service.create(category)
  }
}

const provider = new NodeTracerProvider()
const memoryExporter = new InMemorySpanExporter()
const spanProcessor = new SimpleSpanProcessor(memoryExporter)

const getStoreSpans = () =>
  memoryExporter
    .getFinishedSpans()
    .filter((x) => x.instrumentationLibrary.name === "@equinox-js/core")

const assertRU = (min: number, max: number) => {
  const rus = getStoreSpans().reduce((acc, x) => {
    if (x.attributes["eqx.ru"]) return acc + Number(x.attributes["eqx.ru"])
    return acc
  }, 0)
  expect(rus).toBeGreaterThanOrEqual(min)
  expect(rus).toBeLessThanOrEqual(max)
}
const assertSpans = (...expected: Record<string, any>[]) => {
  const attributes = getStoreSpans().map((x) => ({
    name: x.name,
    ...x.attributes,
    status_message: x.status.message,
  }))
  expect(attributes).toEqual(expected.map(expect.objectContaining))
  memoryExporter.reset()
}

provider.addSpanProcessor(spanProcessor)
provider.register()
afterEach(() => {
  memoryExporter.reset()
})
afterAll(() => provider.shutdown())

namespace CartHelpers {
  const addAndThenRemoveItems = (
    optimistic: boolean,
    exceptTheLastOne: boolean,
    context: Cart.Context,
    cartId: Cart.CartId,
    skuId: Cart.SkuId,
    service: Cart.Service,
    count: number,
  ) =>
    service.executeManyAsync(
      cartId,
      optimistic,
      Array.from(
        (function* (): Iterable<Cart.Command> {
          for (let i = 1; i <= count; ++i) {
            yield { type: "SyncItem", context, skuId, quantity: i }
            if (!exceptTheLastOne || i !== count) {
              yield { type: "SyncItem", context, skuId, quantity: 0 }
            }
          }
        })(),
      ),
    )
  export const addAndThenRemoveItemsManyTimes = (
    context: Cart.Context,
    cartId: Cart.CartId,
    skuId: Cart.SkuId,
    service: Cart.Service,
    count: number,
  ) => addAndThenRemoveItems(false, false, context, cartId, skuId, service, count)

  export const addAndThenRemoveItemsManyTimesExceptTheLastOne = (
    context: Cart.Context,
    cartId: Cart.CartId,
    skuId: Cart.SkuId,
    service: Cart.Service,
    count: number,
  ) => addAndThenRemoveItems(false, true, context, cartId, skuId, service, count)

  export const addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne = (
    context: Cart.Context,
    cartId: Cart.CartId,
    skuId: Cart.SkuId,
    service: Cart.Service,
    count: number,
  ) => addAndThenRemoveItems(true, true, context, cartId, skuId, service, count)
}

describe("Round-trips against the store", () => {
  test("batches the reads correctly [without any optimizations]", async () => {
    const batchSize = 3
    const context = createContext(client, batchSize)
    const service = CartService.createWithoutOptimization(context)

    // The command processing should trigger only a single read and a single write call
    const addRemoveCount = 6
    const cartId = randomUUID() as Cart.CartId
    const skuId = randomUUID() as Cart.SkuId

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }

    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId,
      service,
      addRemoveCount,
    )

    assertRU(2, 3)
    assertSpans({
      name: "Transact",
      [Tags.pages]: 1,
      [Tags.batches]: 0,
      [Tags.loaded_count]: 0,
      [Tags.append_count]: 11,
    })

    let state = await service.read(cartId)
    expect(state.items).toEqual([expect.objectContaining({ quantity: addRemoveCount })])

    const expectedEventCount = 2 * addRemoveCount - 1
    // because dynamo requires that appends always first go through the tip we end up with a single tip read here
    assertRU(0, 1)
    assertSpans({
      name: "Query",
      [Tags.pages]: 1,
      [Tags.batches]: 1,
      [Tags.loaded_count]: expectedEventCount,
    })

    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId,
      service,
      addRemoveCount,
    )
    assertRU(20, 30)
    assertSpans({
      name: "Transact",
      [Tags.pages]: 1,
      [Tags.batches]: 1,
      [Tags.loaded_count]: 11,
      [Tags.append_count]: 11,
    })
    state = await service.read(cartId)
    expect(state.items).toEqual([expect.objectContaining({ quantity: addRemoveCount })])
    assertRU(0, 2)
    assertSpans({
      name: "Query",
      [Tags.pages]: 1,
      [Tags.batches]: 2,
      [Tags.loaded_count]: expectedEventCount * 2,
    })
  })
  test("manages sync conflicts by retrying [without any optimizations]", async () => {
    const batchSize = 3
    const context = createContext(client, batchSize)

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.create()
    const [sku11, sku12, sku21, sku22] = new Array(4).map(() => randomUUID())

    const service1 = CartService.createWithoutOptimization(context)
    const act = (
      prepare: () => Promise<void>,
      service: Cart.Service,
      skuId: string,
      count: number,
    ) =>
      service.executeManyAsync(
        cartId,
        false,
        [{ type: "SyncItem", skuId, quantity: count, context: cartContext }],
        prepare,
      )

    const waiter = () => {
      let resolve: (_: unknown) => void
      return [
        new Promise((res) => {
          resolve = res
        }),
        () => resolve(undefined),
      ] as const
    }

    const [w0, s0] = waiter()
    const [w1, s1] = waiter()
    const [w2, s2] = waiter()
    const [w3, s3] = waiter()
    const [w4, s4] = waiter()

    const t1 = async () => {
      const prepare = async () => {
        // Wait for other to have state, signal we have it, await conflict and handle
        await w0
        s1()
        await w2
      }
      await act(prepare, service1, sku11, 11)
      // Wait for other side to load; generate conflict
      const prepare2 = async () => {
        await w3
      }
      await act(prepare2, service1, sku12, 12)
      s4()
    }

    const service2 = CartService.createWithoutOptimization(context)
    const t2 = async () => {
      // Signal we have state, wait for other to do same, engineer conflict
      const prepare = async () => {
        s0()
        await w1
      }
      await act(prepare, service2, sku21, 21)
      s2()
      const prepare2 = async () => {
        s3()
        await w4
      }
      await act(prepare2, service2, sku22, 22)
    }

    await Promise.all([t1(), t2()])

    const state = await service1.read(cartId)
    const qty = Object.fromEntries(state.items.map((x) => [x.skuId, x.quantity]))
    expect(qty).toEqual({
      [sku11]: 11,
      [sku12]: 12,
      [sku21]: 21,
      [sku22]: 22,
    })
    const syncs = memoryExporter.getFinishedSpans().filter((x) => x.name === "Transact")
    const conflicts = syncs.filter((x) => x.events.find((x) => x.name == "Conflict"))
    expect(syncs).toHaveLength(4)
    expect(conflicts).toHaveLength(2)
  })
})

describe("Caching", () => {
  test("avoids redundant reads", async () => {
    const batchSize = 10
    const context = createContext(client, batchSize)
    const createServiceCached = () => CartService.createWithCaching(context)
    const service1 = createServiceCached()
    const service2 = createServiceCached()
    const service3 = CartService.createWithoutOptimization(context)

    const cartId = randomUUID() as Cart.CartId
    const skuId = randomUUID() as Cart.SkuId

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }

    // Trigger 9 events, then reload
    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId,
      service1,
      5,
    )
    assertRU(1, 3)
    assertSpans({
      name: "Transact",
      [Tags.load_method]: "BatchBackward",
      [Tags.loaded_count]: 0,
      [Tags.append_count]: 9,
    })
    const staleRes = await service2.readStale(cartId)
    memoryExporter.reset()
    const freshRes = await service2.read(cartId)
    expect(staleRes).toEqual(freshRes)

    assertRU(0.5, 2)
    assertSpans({
      name: "Query",
      [Tags.loaded_count]: 0,
      [Tags.loaded_from_version]: "9",
      [Tags.cache_hit]: true,
    })

    // Add one more - the round-trip should only incur a single read

    const skuId2 = randomUUID() as Cart.SkuId
    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId2,
      service1,
      1,
    )
    assertRU(2, 3)
    assertSpans({
      name: "Transact",
      [Tags.loaded_count]: 0,
      [Tags.cache_hit]: true,
      [Tags.append_count]: 1,
    })

    const res = await service2.readStale(cartId)
    expect(res).not.toEqual(freshRes)
    assertSpans({ name: "Query", [Tags.cache_hit]: true })
    await service2.read(cartId)
    assertRU(0.5, 1)
    assertSpans({ name: "Query", [Tags.loaded_count]: 0, [Tags.cache_hit]: true })

    // Optimistic transactions
    // As the cache is up-to-date, we can transact against the cached value and do a null transaction without a round-trip
    await CartHelpers.addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId2,
      service1,
      1,
    )
    let attrs = getStoreSpans()[0].attributes
    assertSpans({ name: "Transact", [Tags.cache_hit]: true, [Tags.allow_stale]: true })
    expect(attrs).not.to.have.property(Tags.batches)
    expect(attrs).not.to.have.property(Tags.append_count)
    // As the cache is up-to-date, we can do an optimistic append, saving a Read round-trip
    const skuId3 = randomUUID() as Cart.SkuId
    await CartHelpers.addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId3,
      service1,
      1,
    )

    // this time, we did something, so we see the append call
    attrs = getStoreSpans()[0].attributes
    assertRU(7, 10)
    assertSpans({ name: "Transact", [Tags.cache_hit]: true, [Tags.append_count]: 1 })
    expect(attrs).not.to.have.property(Tags.batches)

    // If we don't have a cache attached, we don't benefit from / pay the price for any optimism
    const skuId4 = randomUUID() as Cart.SkuId
    await CartHelpers.addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId4,
      service3,
      1,
    )
    // Need 2 batches to do the reading
    assertRU(1, 2)
    assertSpans({
      name: "Transact",
      [Tags.batches]: 2,
      [Tags.cache_hit]: false,
      [Tags.append_count]: 1,
    })
    // we've engineered a clash with the cache state (service3 doest participate in caching)
    // Conflict with cached state leads to a read forward to re-sync; Then we'll idempotently decide not to do any append
    memoryExporter.reset()
    await CartHelpers.addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId4,
      service2,
      1,
    )

    const events = memoryExporter.getFinishedSpans()[0].events
    assertRU(1, 2)
    assertSpans({ name: "Transact", [Tags.cache_hit]: true, [Tags.allow_stale]: true })
    expect(events).toEqual([expect.objectContaining({ name: "Conflict" })])
  })
})

describe("AccessStrategy.LatestKnownEvent", () => {
  test("Can correctly read and update Contacts against DocStore with LatestKnownEvent", async () => {
    const cache = new MemoryCache()
    const service = ContactPreferencesService.createService(client, cache)
    const username = randomUUID().replace(/-/g, "")
    const id = ContactPreferences.ClientId.parse(`${username}@example.com`)
    // prettier-ignore
    const value = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: true }
    // prettier-ignore
    const otherValue = { manyPromotions: false, littlePromotions: false, productReview: true, quickSurveys: true }
    for (let i = 1; i <= 13; ++i) {
      await service.update(id, i % 2 === 0 ? value : otherValue)
    }
    memoryExporter.reset()
    await service.update(id, value)
    const result = await service.read(id)
    expect(result).toEqual(value)
    const staleResult = await service.readStale(id) // should not trigger roundtrip
    expect(staleResult).toEqual(value)
    assertSpans(
      { name: "Transact", "eqx.load.tip_result": "NotModified" },
      { name: "Query", "eqx.load.tip_result": "NotModified" },
      { name: "Query", [Tags.cache_hit]: true, [Tags.allow_stale]: true },
    )
  })

  test("Can correctly read and update Contacts against DocStore with LatestKnownEvent without Caching", async () => {
    const service = ContactPreferencesService.createService(client)
    const username = randomUUID().replace(/-/g, "")
    const id = ContactPreferences.ClientId.parse(`${username}@example.com`)
    // prettier-ignore
    const value = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: true }
    // prettier-ignore
    const otherValue = { manyPromotions: false, littlePromotions: false, productReview: true, quickSurveys: true }
    for (let i = 1; i <= 13; ++i) {
      await service.update(id, i % 2 === 0 ? value : otherValue)
    }
    memoryExporter.reset()
    await service.update(id, value)
    const result = await service.read(id)
    expect(result).toEqual(value)
    assertSpans(
      { name: "Transact", "eqx.load.tip": true, "eqx.load.tip_result": "Found" },
      { name: "Query", "eqx.load.tip": true, "eqx.load.tip_result": "Found" },
    )
  })
})

describe("AccessStrategy.Snapshot", () => {
  test("Can roundtrip against DocStore, using Snapshotting to avoid queries", async () => {
    const context = createContext(client, 10)
    const [service1, service2] = [
      CartService.createWithSnapshotStrategy(context),
      CartService.createWithSnapshotStrategy(context),
    ]

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.create()
    const skuId = randomUUID()

    // Trigger 10 events, then reload
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 5)
    await service2.read(cartId)
    assertSpans(
      { name: "Transact", "eqx.load.tip_result": "NotFound" },
      { name: "Query", "eqx.load.tip_result": "Found" },
    )

    // Add two more - the roundtrip should only incur a single read
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 1)
    assertSpans({ name: "Transact", "eqx.load.tip_result": "Found" })
    // While we now have 12 events, we should be able to read them with a single call
    await service2.read(cartId)
    assertSpans({ name: "Query", "eqx.load.tip_result": "Found" })
  })

  test("Can roundtrip against DocStore, correctly using Snapshotting and Cache to avoid redundant reads", async () => {
    const queryMaxItems = 10
    const context = createContext(client, queryMaxItems)
    const [service1, service2] = [
      CartService.createWithSnapshotStrategyAndCaching(context),
      CartService.createWithSnapshotStrategyAndCaching(context),
    ]

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.create()
    const skuId = randomUUID()

    // Trigger 10 events, then reload
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 5)
    await service2.read(cartId)
    assertSpans(
      { name: "Transact", "eqx.load.tip_result": "NotFound" },
      { name: "Query", "eqx.load.tip_result": "NotModified" },
    )

    // Add two more - the roundtrip should only incur a single read
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 1)
    assertSpans({ name: "Transact", "eqx.load.tip_result": "NotModified" })

    // While we now have 12 events, we should be able to read them with a single call
    await service2.read(cartId)
    assertSpans({ name: "Query", "eqx.load.tip_result": "NotModified" })
  })
})

test("Version is 0-based", async () => {
  const batchSize = 3
  const context = createContext(client, batchSize)
  let id = StreamId.create(randomUUID())
  const decider = SimplestThing.resolve(context, SimplestThing.categoryName, id)
  const [before, after] = await decider.transactExMapResult(
    (ctx) => [ctx.version, [{ type: "StuffHappened" }]],
    (result, ctx) => [result, ctx.version],
  )
  expect([before, after]).toEqual([0n, 1n])
})
