import { AccessStrategy, CachingStrategy, DynamoStoreCategory, DynamoStoreClient, DynamoStoreContext } from "@equinox-js/dynamo-store"
import * as Cart from "./domain/Cart"
import * as ContactPreferences from "./domain/ContactPreferences"
import { Decider, ICache, MemoryCache } from "@equinox-js/core"
import { describe, test, expect, afterEach, afterAll, beforeAll } from "vitest"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { randomUUID } from "crypto"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { SpanStatusCode } from "@opentelemetry/api"

namespace CartService {
  type E = Cart.Events.Event
  type S = Cart.Fold.State
  const codec = Cart.Events.asyncCodec
  const fold = Cart.Fold.fold
  const initial = Cart.Fold.initial
  const cache = new MemoryCache()
  const noCache = CachingStrategy.NoCaching()
  export function createWithoutOptimization(context: DynamoStoreContext) {
    const category = DynamoStoreCategory.build(context, codec, fold, initial, noCache, AccessStrategy.Unoptimized())
    return Cart.create((cat, streamId) => Decider.resolve(category, cat, streamId, null))
  }

  export function createWithEmptyUnfolds(context: DynamoStoreContext) {
    const access = AccessStrategy.MultiSnapshot<E, S>(Cart.Fold.isOrigin, () => [])
    const category = DynamoStoreCategory.build(context, codec, fold, initial, noCache, access)
    return Cart.create((cat, streamId) => Decider.resolve(category, cat, streamId, null))
  }

  export function createWithSnapshotStrategy(context: DynamoStoreContext) {
    const access = AccessStrategy.Snapshot<E, S>(Cart.Fold.isOrigin, Cart.Fold.snapshot)
    const category = DynamoStoreCategory.build(context, codec, fold, initial, noCache, access)
    return Cart.create((cat, streamId) => Decider.resolve(category, cat, streamId, null))
  }

  const sliding20m = CachingStrategy.SlidingWindow(cache, 20 * 60 * 1000)
  export function createWithSnapshotStrategyAndCaching(context: DynamoStoreContext) {
    const access = AccessStrategy.Snapshot<E, S>(Cart.Fold.isOrigin, Cart.Fold.snapshot)
    const category = DynamoStoreCategory.build(context, codec, fold, initial, sliding20m, access)
    return Cart.create((cat, streamId) => Decider.resolve(category, cat, streamId, null))
  }
  export function createWithRollingState(context: DynamoStoreContext) {
    const access = AccessStrategy.RollingState(Cart.Fold.snapshot)
    const category = DynamoStoreCategory.build(context, codec, fold, initial, noCache, access)
    return Cart.create((cat, streamId) => Decider.resolve(category, cat, streamId, null))
  }
}

namespace ContactPreferencesService {
  const fold = ContactPreferences.Fold.fold
  const initial = ContactPreferences.Fold.initial
  const codec = ContactPreferences.Events.asyncCodec
  const createWithLatestKnownEvent = (context: DynamoStoreContext, cachingStrategy: CachingStrategy.CachingStrategy) => {
    const category = DynamoStoreCategory.build(context, codec, fold, initial, cachingStrategy, AccessStrategy.LatestKnownEvent())
    return ContactPreferences.create((cat, streamId) => Decider.resolve(category, cat, streamId, null))
  }

  export const createWithoutCaching = (context: DynamoStoreContext) => createWithLatestKnownEvent(context, CachingStrategy.NoCaching())
  export const createWithCaching = (context: DynamoStoreContext, cache: ICache) => {
    const sliding20m = CachingStrategy.SlidingWindow(cache, 20 * 60 * 1000)
    return createWithLatestKnownEvent(context, sliding20m)
  }
}

const ddb = new DynamoDB({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://localhost:8000",
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
const createPrimaryContextEx = (queryMaxItems: number, maxEvents: number) => {
  const client = DynamoStoreClient.build(ddb, "test_events")
  return new DynamoStoreContext(client, undefined, maxEvents, queryMaxItems)
}

describe("DynamoStore", () => {
  const addAndThenRemoveItems = (
    optimistic: boolean,
    exceptTheLastOne: boolean,
    context: Cart.Context,
    cartId: Cart.CartId,
    skuId: Cart.SkuId,
    service: Cart.Service,
    count: number
  ) =>
    service.executeManyAsync(
      cartId,
      optimistic,
      Array.from(
        (function* () {
          for (let i = 1; i <= count; ++i) {
            yield { type: "SyncItem", context, skuId, quantity: i }
            if (!exceptTheLastOne || i !== count) {
              yield { type: "SyncItem", context, skuId, quantity: 0 }
            }
          }
        })()
      )
    )
  const addAndThenRemoveItemsManyTimes = (context: Cart.Context, cartId: Cart.CartId, skuId: Cart.SkuId, service: Cart.Service, count: number) =>
    addAndThenRemoveItems(false, false, context, cartId, skuId, service, count)

  const addAndThenRemoveItemsManyTimesExceptTheLastOne = (
    context: Cart.Context,
    cartId: Cart.CartId,
    skuId: Cart.SkuId,
    service: Cart.Service,
    count: number
  ) => addAndThenRemoveItems(false, true, context, cartId, skuId, service, count)

  const provider = new NodeTracerProvider()
  const memoryExporter = new InMemorySpanExporter()
  const spanProcessor = new SimpleSpanProcessor(memoryExporter)

  const getDynamoSpans = () => memoryExporter.getFinishedSpans().filter((x) => x.instrumentationLibrary.name === "@equinox-js/dynamo-store")

  provider.addSpanProcessor(spanProcessor)
  provider.register()
  afterEach(() => {
    memoryExporter.reset()
  })
  afterAll(() => provider.shutdown())

  test("Can roundtrip against DocStore, correctly batching the reads", async () => {
    let addRemoveCount = 40
    let eventsPerAction = addRemoveCount * 2 - 1
    let queryMaxItems = 3
    const context = createPrimaryContextEx(queryMaxItems, 3)
    const service = CartService.createWithoutOptimization(context)
    const expectedResponses = (n: number) => {
      const tipItem = 1
      const expectedItems = tipItem + n + 1
      return Math.max(1, Math.ceil(expectedItems / queryMaxItems))
    }

    const cartId = Cart.CartId.ofString(randomUUID())
    const skuId = randomUUID()
    const transactions = 6
    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    for (let i = 0; i < transactions; ++i) {
      await addAndThenRemoveItemsManyTimesExceptTheLastOne(cartContext, cartId, skuId, service, addRemoveCount)
      const spans = getDynamoSpans()
      expect(spans.filter((x) => x.name === "QueryBatch" && x.attributes["eqx.direction"] === "Backwards")).toHaveLength(expectedResponses(i))
      memoryExporter.reset()
    }

    const state = await service.read(cartId)
    expect(state.items[0].quantity).toBe(addRemoveCount)

    const spans = getDynamoSpans()
    expect(spans.filter((x) => x.name === "QueryBatch" && x.attributes["eqx.direction"] === "Backwards")).toHaveLength(
      expectedResponses(transactions)
    )
  })

  test("Can correctly read and update Contacts against DocStore with LatestKnownEvent", async () => {
    const context = createPrimaryContextEx(1, 10)
    const cache = new MemoryCache()
    const service = ContactPreferencesService.createWithCaching(context, cache)
    const username = randomUUID().replace(/-/g, "")
    const id = ContactPreferences.ClientId.ofString(`${username}@example.com`)
    const value = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: false }
    const otherValue = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: true }
    for (let i = 1; i <= 13; ++i) {
      await service.update(id, i % 2 === 0 ? value : otherValue)
    }
    memoryExporter.reset()
    await service.update(id, value)
    const result = await service.read(id)
    expect(result).toEqual(value)
    const staleResult = await service.readStale(id) // should not trigger roundtrip
    expect(staleResult).toEqual(value)
    expect(memoryExporter.getFinishedSpans().filter((x) => x.name === "TrySync")).toHaveLength(1)
    expect(getDynamoSpans().filter((x) => x.name === "Tip.tryLoad" && x.attributes["eqx.result"] === "NotModified")).toHaveLength(2)
  })

  test("Can correctly read and update Contacts against DocStore with LatestKnownEvent without Caching", async () => {
    const context = createPrimaryContextEx(1, 10)
    const service = ContactPreferencesService.createWithoutCaching(context)
    const username = randomUUID().replace(/-/g, "")
    const id = ContactPreferences.ClientId.ofString(`${username}@example.com`)
    const value = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: true }
    const otherValue = { manyPromotions: false, littlePromotions: false, productReview: true, quickSurveys: true }
    for (let i = 1; i <= 13; ++i) {
      await service.update(id, i % 2 === 0 ? value : otherValue)
    }
    memoryExporter.reset()
    await service.update(id, value)
    const result = await service.read(id)
    expect(result).toEqual(value)
    expect(memoryExporter.getFinishedSpans().filter((x) => x.name === "TrySync")).toHaveLength(1)
    expect(getDynamoSpans().filter((x) => x.name === "Tip.tryLoad" && x.attributes["eqx.result"] === "Found")).toHaveLength(2)
  })

  test("Can roundtrip against DocStore, using Snapshotting to avoid queries", async () => {
    const queryMaxItems = 10
    const context = createPrimaryContextEx(queryMaxItems, 10)
    const [service1, service2] = [CartService.createWithSnapshotStrategy(context), CartService.createWithSnapshotStrategy(context)]

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.ofString(randomUUID())
    const skuId = randomUUID()

    // Trigger 10 events, then reload
    await addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 5)
    await service2.read(cartId)
    let spans = getDynamoSpans().filter((x) => x.name === "Tip.tryLoad")
    expect(spans).toHaveLength(2)
    expect(spans[0].attributes["eqx.result"]).toBe("NotFound")
    expect(spans[1].attributes["eqx.result"]).toBe("Found")
    memoryExporter.reset()

    // Add two more - the roundtrip should only incur a single read
    await addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 1)
    spans = getDynamoSpans().filter((x) => x.name === "Tip.tryLoad")
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes["eqx.result"]).toBe("Found")
    memoryExporter.reset()

    // While we now have 12 events, we should be able to read them with a single call
    await service2.read(cartId)
    spans = getDynamoSpans().filter((x) => x.name === "Tip.tryLoad")
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes["eqx.result"]).toBe("Found")
  })

  test("Can roundtrip against DocStore, correctly using Snapshotting and Cache to avoid redundant reads", async () => {
    const queryMaxItems = 10
    const context = createPrimaryContextEx(queryMaxItems, 10)
    const [service1, service2] = [
      CartService.createWithSnapshotStrategyAndCaching(context),
      CartService.createWithSnapshotStrategyAndCaching(context),
    ]

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.ofString(randomUUID())
    const skuId = randomUUID()

    // Trigger 10 events, then reload
    await addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 5)
    await service2.read(cartId)
    let spans = getDynamoSpans().filter((x) => x.name === "Tip.tryLoad")
    expect(spans).toHaveLength(2)
    expect(spans[0].attributes["eqx.result"]).toBe("NotFound")
    expect(spans[1].attributes["eqx.result"]).toBe("NotModified")
    memoryExporter.reset()

    // Add two more - the roundtrip should only incur a single read
    await addAndThenRemoveItemsManyTimes(cartContext, cartId, skuId, service1, 1)
    spans = getDynamoSpans().filter((x) => x.name === "Tip.tryLoad")
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes["eqx.result"]).toBe("NotModified")
    memoryExporter.reset()

    // While we now have 12 events, we should be able to read them with a single call
    await service2.read(cartId)
    spans = getDynamoSpans().filter((x) => x.name === "Tip.tryLoad")
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes["eqx.result"]).toBe("NotModified")
  })

  test("Can roundtrip against DocStore, managing sync conflicts by retrying", async () => {
    const queryMaxItems = 3
    const context = createPrimaryContextEx(queryMaxItems, 10)

    const cartContext: Cart.Context = { requestId: randomUUID(), time: new Date() }
    const cartId = Cart.CartId.ofString(randomUUID())
    const [sku11, sku12, sku21, sku22] = new Array(4).map(() => randomUUID())

    const service1 = CartService.createWithEmptyUnfolds(context)
    const act = (prepare: () => Promise<void>, service: Cart.Service, skuId: string, count: number) =>
      service.executeManyAsync(cartId, false, [{ type: "SyncItem", skuId, quantity: count, context: cartContext }], prepare)

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

    const service2 = CartService.createWithEmptyUnfolds(context)
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
    const syncs = memoryExporter.getFinishedSpans().filter((x) => x.name === "TrySync")
    const conflicts = syncs.filter((x) => x.status?.code === SpanStatusCode.ERROR && x.status?.message === "ConflictUnknown")
    expect(syncs).toHaveLength(6)
    expect(conflicts).toHaveLength(2)
  })
})
