import { describe, test, expect, vi } from "vitest"
import * as Cache from "../src/lib/Cache"
import { StreamToken, TokenAndState } from "../src"

const supersedes = (current: StreamToken, x: StreamToken) => x.version > current.version

describe("Caching", () => {
  const anyValue = Number.MAX_SAFE_INTEGER
  const read = (version: bigint) => (): Promise<TokenAndState<null>> =>
    Promise.resolve({ state: null, token: { version, bytes: 0n, value: null } })
  test("loading a value from the cache", async () => {
    const cache = new Cache.MemoryCache(2)
    const tns = await cache.readThrough("1", 0, supersedes, read(1n))
    const item = await cache.readThrough("1", anyValue, supersedes, () => {
      throw new Error("Unexpected reload")
    })
    expect(item).toEqual(tns)
  })

  test("reloads when evicted", async () => {
    const cache = new Cache.MemoryCache(2)
    await cache.readThrough("1", 0, supersedes, read(1n))
    await cache.readThrough("2", 0, supersedes, read(1n))
    await cache.readThrough("3", 0, supersedes, read(1n))
    const item = await cache.readThrough("1", anyValue, supersedes, read(2n))
    expect(item).toEqual({ state: null, token: { version: 2n, bytes: 0n, value: null } })
  })

  test("reloads when stale", async () => {
    const cache = new Cache.MemoryCache(2)
    await cache.readThrough("1", 0, supersedes, read(1n))
    await sleep(5)
    const item = await cache.readThrough("1", 1, supersedes, read(2n))
    expect(item).toEqual({ state: null, token: { version: 2n, bytes: 0n, value: null } })
  })

  test("only one reload of a stream is in flight at any given moment", async () => {
    const reload = vi
      .fn()
      .mockImplementationOnce(async () => {
        await sleep(5)
        return read(1n)()
      })
      .mockRejectedValue(new Error("Unexpected reload"))

    const cache = new Cache.MemoryCache(2)
    const p1 = cache.readThrough("1", anyValue, supersedes, reload)
    const p2 = cache.readThrough("1", anyValue, supersedes, reload)
    const p3 = cache.readThrough("1", anyValue, supersedes, reload)
    await Promise.all([p1, p2, p3])
  })
})

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
