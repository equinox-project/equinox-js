import { describe, test, expect, vi } from "vitest"
import * as Cache from "../src/lib/Cache"
import { TokenAndState } from "../src"

describe("Caching", () => {
  const anyValue = Number.MAX_SAFE_INTEGER
  const read = (version: bigint) => (): Promise<TokenAndState<null>> =>
    Promise.resolve({ state: null, token: { version, bytes: 0n, value: null } })
  test("loading a value from the cache", async () => {
    const cache = new Cache.MemoryCache(2)
    const tns = await cache.readThrough("1", 0, read(1n))
    const item = await cache.readThrough("1", anyValue, () => {
      throw new Error("Unexpected reload")
    })
    expect(item).toEqual(tns)
  })

  test("reloads when evicted", async () => {
    const cache = new Cache.MemoryCache(2)
    await cache.readThrough("1", 0, read(1n))
    await cache.readThrough("2", 0, read(1n))
    await cache.readThrough("3", 0, read(1n))
    const item = await cache.readThrough("1", anyValue, read(2n))
    expect(item).toEqual({ state: null, token: { version: 2n, bytes: 0n, value: null } })
  })

  test("reloads when stale", async () => {
    const cache = new Cache.MemoryCache(2)
    await cache.readThrough("1", 0, read(1n))
    await sleep(5)
    const item = await cache.readThrough("1", 1, read(2n))
    expect(item).toEqual({ state: null, token: { version: 2n, bytes: 0n, value: null } })
  })

  test("only one reload of a stream is in flight at any given moment", async () => {
    let count = 0
    const reload = vi.fn().mockImplementation(async () => {
      if (count !== 0) new Error("Unexpected reload")
      count++
      await sleep(5)
      return read(1n)()
    })

    const cache = new Cache.MemoryCache(2)
    const p1 = await cache.readThrough("1", anyValue, reload)
    const p2 = await cache.readThrough("1", anyValue, reload)
    const p3 = await cache.readThrough("1", anyValue, reload)
    await Promise.all([p1, p2, p3])
  })
})

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
