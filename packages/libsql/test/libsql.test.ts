import { Cart, ContactPreferences } from "../../test-domain/src/index.js"
import { Decider, MemoryCache, Codec, CachingStrategy, Tags, StreamId } from "@equinox-js/core"
import { describe, test, expect, afterEach, afterAll, vi, beforeAll } from "vitest"
import { randomUUID } from "crypto"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import fs from "fs"
import {
  AccessStrategy,
  LibSqlCategory,
  LibSqlConnection,
  LibSqlContext,
  initializeDatabase,
} from "../src/index.js"
import { createClient } from "@libsql/client"

const Category = LibSqlCategory

const defaultBatchSize = 500

namespace CartService {
  type E = Cart.Events.Event
  type S = Cart.Fold.State
  const codec = Cart.Events.codec
  const fold = Cart.Fold.fold
  const initial = Cart.Fold.initial
  const cache = new MemoryCache()
  const noCache = CachingStrategy.NoCache()

  export function createWithoutOptimization(context: LibSqlContext) {
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

  export function createWithSnapshotStrategy(context: LibSqlContext) {
    const access = AccessStrategy.Snapshot<E, S>(Cart.Fold.isOrigin, Cart.Fold.snapshot)
    const category = Category.create(context, Cart.Category, codec, fold, initial, noCache, access)
    return Cart.Service.create(category)
  }

  const caching = CachingStrategy.Cache(cache)

  export function createWithCaching(context: LibSqlContext) {
    const category = Category.create(context, Cart.Category, codec, fold, initial, caching)
    return Cart.Service.create(category)
  }

  export function createWithSnapshotStrategyAndCaching(context: LibSqlContext) {
    const access = AccessStrategy.Snapshot<E, S>(Cart.Fold.isOrigin, Cart.Fold.snapshot)
    const category = Category.create(context, Cart.Category, codec, fold, initial, caching, access)
    return Cart.Service.create(category)
  }

  export function createWithRollingState(context: LibSqlContext, cache = false) {
    const access = AccessStrategy.RollingState(Cart.Fold.snapshot)
    const cachestrat = cache ? caching : noCache
    const category = Category.create(
      context,
      Cart.Category,
      codec,
      fold,
      initial,
      cachestrat,
      access,
    )
    return Cart.Service.create(category)
  }
}

try {
  fs.mkdirSync("./.data")
} catch {}
const libSqlClient = createClient({
  url: "file:./.data/message_store.db",
})
const client = LibSqlConnection.create(libSqlClient)

beforeAll(async () => {
  await initializeDatabase(libSqlClient)
})

const waiter = () => {
  let resolve: (_: unknown) => void
  return [
    new Promise((res) => {
      resolve = res
    }),
    () => resolve(undefined),
  ] as const
}

const createContext = (connection: LibSqlConnection, batchSize: number) =>
  new LibSqlContext(connection, batchSize)

namespace SimplestThing {
  export type Event = { type: "StuffHappened" }
  export const codec = Codec.json<Event>()
  export const evolve = (_state: Event, event: Event) => event
  export const initial: Event = { type: "StuffHappened" }
  export const fold = (_state: Event, events: Event[]) => events.reduce(evolve, initial)
  export const categoryName = "SimplestThing"
  export const resolve = (context: LibSqlContext, categoryName: string, streamId: StreamId) => {
    const category = Category.create(context, categoryName, codec, fold, initial)
    return Decider.forStream(category, streamId, undefined)
  }
}

namespace ContactPreferencesService {
  const { fold, initial, codec } = ContactPreferences

  export const createService = (client: LibSqlConnection) => {
    const context = createContext(client, defaultBatchSize)
    const category = Category.create(
      context,
      ContactPreferences.Category,
      codec,
      fold,
      initial,
      undefined,
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

const assertSpans = (...expected: Record<string, any>[]) => {
  const attributes = getStoreSpans().map((x) => ({
    name: x.name,
    ...x.attributes,
    status_message: x.status.message,
  }))
  expect(attributes).toEqual(expected.map(expect.objectContaining))
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

async function manufactureConflict(service1: Cart.Service, service2: Cart.Service) {
  const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
  const cartId = Cart.CartId.create()

  const act = (prepare: () => Promise<void>, service: Cart.Service, skuId: string, count: number) =>
    service.executeManyAsync(
      cartId,
      false,
      [{ type: "SyncItem", skuId, quantity: count, context: cartContext }],
      prepare,
    )
  const sku11 = randomUUID() as Cart.SkuId
  const sku12 = randomUUID() as Cart.SkuId
  const sku21 = randomUUID() as Cart.SkuId
  const sku22 = randomUUID() as Cart.SkuId

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
  return { cartId, sku11, sku12, sku21, sku22 }
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
    debugger

    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId,
      service,
      addRemoveCount,
    )

    assertSpans({
      name: "Transact",
      [Tags.batches]: 1,
      [Tags.loaded_count]: 0,
      [Tags.append_count]: 11,
    })
    memoryExporter.reset()

    const state = await service.read(cartId)
    expect(state.items).toEqual([expect.objectContaining({ quantity: addRemoveCount })])

    const expectedEventCount = 2 * addRemoveCount - 1
    const expectedBatches = Math.ceil(expectedEventCount / batchSize)
    assertSpans({
      name: "Query",
      [Tags.batches]: expectedBatches,
      [Tags.loaded_count]: expectedEventCount,
    })
  })
  test("manages sync conflicts by retrying [without any optimizations]", async () => {
    const batchSize = 3
    const context = createContext(client, batchSize)

    const service1 = CartService.createWithoutOptimization(context)
    const service2 = CartService.createWithoutOptimization(context)

    const { sku11, sku12, sku21, sku22, cartId } = await manufactureConflict(service1, service2)

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

describe("Error handling", () => {
  test("bubbles up DB errors", async () => {
    const batchSize = 10
    const context = createContext(client, batchSize)
    vi.spyOn(client.write["client"], "execute").mockRejectedValueOnce(new Error("Test DB Error"))
    let id = StreamId.create(randomUUID())
    const decider = SimplestThing.resolve(context, SimplestThing.categoryName, id)
    await expect(decider.transact(() => [{ type: "StuffHappened" }])).rejects.toThrow(
      "Test DB Error",
    )
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
    assertSpans({
      name: "Transact",
      [Tags.load_method]: "BatchForward",
      [Tags.loaded_count]: 0,
      [Tags.append_count]: 9,
    })
    const staleRes = await service2.readStale(cartId)
    memoryExporter.reset()
    const freshRes = await service2.read(cartId)
    expect(staleRes).toEqual(freshRes)

    assertSpans({
      name: "Query",
      [Tags.batches]: 1,
      [Tags.loaded_count]: 0,
      [Tags.loaded_from_version]: "10",
      [Tags.cache_hit]: true,
    })
    memoryExporter.reset()

    // Add one more - the round-trip should only incur a single read

    const skuId2 = randomUUID() as Cart.SkuId
    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId2,
      service1,
      1,
    )
    assertSpans({
      name: "Transact",
      [Tags.batches]: 1,
      [Tags.loaded_count]: 0,
      [Tags.cache_hit]: true,
      [Tags.append_count]: 1,
    })
    memoryExporter.reset()

    const res = await service2.readStale(cartId)
    expect(res).not.toEqual(freshRes)
    assertSpans({ name: "Query", [Tags.cache_hit]: true })
    expect(getStoreSpans()[0].attributes).not.to.have.property(Tags.batches)
    memoryExporter.reset()
    await service2.read(cartId)
    assertSpans({ name: "Query", [Tags.batches]: 1, [Tags.cache_hit]: true })

    // Optimistic transactions
    memoryExporter.reset()
    // As the cache is up-to-date, we can transact against the cached value and do a null transaction without a round-trip
    await CartHelpers.addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId2,
      service1,
      1,
    )
    assertSpans({ name: "Transact", [Tags.cache_hit]: true, [Tags.allow_stale]: true })
    expect(getStoreSpans()[0].attributes).not.to.have.property(Tags.batches)
    memoryExporter.reset()
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
    assertSpans({ name: "Transact", [Tags.cache_hit]: true, [Tags.append_count]: 1 })
    expect(getStoreSpans()[0].attributes).not.to.have.property(Tags.batches)

    // If we don't have a cache attached, we don't benefit from / pay the price for any optimism
    memoryExporter.reset()
    const skuId4 = randomUUID() as Cart.SkuId
    await CartHelpers.addAndThenRemoveItemsOptimisticManyTimesExceptTheLastOne(
      cartContext,
      cartId,
      skuId4,
      service3,
      1,
    )
    // Need 2 batches to do the reading
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

    assertSpans({ name: "Transact", [Tags.cache_hit]: true, [Tags.allow_stale]: true })
    expect(memoryExporter.getFinishedSpans()[0].events).toEqual([
      expect.objectContaining({ name: "Conflict" }),
    ])
  })
})

describe("AccessStrategy.LatestKnownEvent", () => {
  test("Reads and updates against Store", async () => {
    const id = randomUUID() as ContactPreferences.ClientId
    const service = ContactPreferencesService.createService(client)
    const value = ContactPreferences.randomPreferences()

    // Feed some junk into the stream
    for (let i = 0; i < 12; ++i) {
      let quickSurveysValue = i % 2 === 0
      await service.update(id, { ...value, quickSurveys: quickSurveysValue })
    }
    // Ensure there will be something to be changed by the Update below
    await service.update(id, { ...value, quickSurveys: !value.quickSurveys })
    memoryExporter.reset()
    await service.update(id, value)

    const result = await service.read(id)
    expect(result).toEqual(value)
    assertSpans(
      {
        name: "Transact",
        [Tags.load_method]: "Last",
        [Tags.loaded_count]: 1,
        [Tags.append_count]: 1,
      },
      { name: "Query", [Tags.load_method]: "Last", [Tags.loaded_count]: 1 },
    )
  })
})

describe("AccessStrategy.Snapshot", () => {
  test("Can roundtrip against LibSql, using Snapshotting to avoid queries", async () => {
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
      { name: "Transact", [Tags.append_count]: 10 },
      { name: "Query", [Tags.snapshot_version]: 10, [Tags.loaded_count]: 1 },
    )
    memoryExporter.reset()

    // Add two more - the roundtrip should only incur a single read
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 1)
    assertSpans({ name: "Transact", [Tags.append_count]: 2, [Tags.snapshot_version]: 10 })
    memoryExporter.reset()
    // While we now have 12 events, we should be able to read them with a single call
    await service2.read(cartId)
    assertSpans({ name: "Query", [Tags.snapshot_version]: 12, [Tags.loaded_count]: 1 })
  })

  test("Can roundtrip against LibSql, correctly using Snapshotting and Cache to avoid redundant reads", async () => {
    const queryMaxItems = 10
    const context = createContext(client, queryMaxItems)
    const service1 = CartService.createWithSnapshotStrategyAndCaching(context)
    const service2 = CartService.createWithSnapshotStrategyAndCaching(context)

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.create()
    const skuId = randomUUID()

    // Trigger 10 events, then reload
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 5)
    await service2.read(cartId)
    assertSpans(
      { name: "Transact", [Tags.loaded_count]: 0, [Tags.append_count]: 10 },
      {
        name: "Query",
        [Tags.loaded_from_version]: "11",
        [Tags.loaded_count]: 0,
        [Tags.cache_hit]: true,
      },
    )
    memoryExporter.reset()

    // Add two more - the roundtrip should only incur a single read
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 1)
    assertSpans({
      name: "Transact",
      [Tags.loaded_count]: 0,
      [Tags.append_count]: 2,
      [Tags.cache_hit]: true,
    })
    memoryExporter.reset()

    // While we now have 12 events, we should be able to read them with a single call
    await service2.read(cartId)
    assertSpans({ name: "Query", [Tags.loaded_count]: 0, [Tags.cache_hit]: true })
  })
})

describe("AccessStrategy.RollingState", () => {
  test("Can roundtrip against DocStore with RollingState, detecting conflicts based on etag", async () => {
    const queryMaxItems = 10
    const context = createContext(client, queryMaxItems)
    const service1 = CartService.createWithRollingState(context)
    const service2 = CartService.createWithRollingState(context)

    const { sku11, sku12, sku21, sku22, cartId } = await manufactureConflict(service1, service2)

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

  // Caching doesn't really matter for RollingState as we always do a point read anyway
  test("Can roundtrip against DocStore with RollingState correctly using and Cache to avoid redundant reads", async () => {
    const queryMaxItems = 10
    const context = createContext(client, queryMaxItems)
    const service1 = CartService.createWithRollingState(context, true)
    const service2 = CartService.createWithRollingState(context, true)

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.create()
    const skuId = randomUUID()

    // Trigger 10 events, then reload
    await CartHelpers.addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 5)
    await service2.read(cartId)
    assertSpans(
      { name: "Transact", [Tags.loaded_count]: 0, [Tags.append_count]: 10 },
      { name: "Query", [Tags.loaded_count]: 1, [Tags.cache_hit]: true },
    )
    memoryExporter.reset()

    // the roundtrip should only incur a single read
    await CartHelpers.addAndThenRemoveItemsManyTimesExceptTheLastOne(cartContext, cartId, skuId, service1, 1)
    assertSpans({
      name: "Transact",
      [Tags.loaded_count]: 1,
      [Tags.append_count]: 1,
      [Tags.cache_hit]: true,
    })
    memoryExporter.reset()

    // Sanity check for whether our Token.supersedes logic is working
    const stale = await service2.readStale(cartId)
    const fresh = await service2.read(cartId)
    assertSpans(
      { name: "Query", [Tags.loaded_count]: 0, [Tags.cache_hit]: true },
      { name: "Query", [Tags.loaded_count]: 1, [Tags.cache_hit]: true },
    )
    expect(stale).toEqual(fresh)
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
