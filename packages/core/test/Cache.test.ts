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
    const now = new Date()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const cache = new Cache.MemoryCache(2)
    await cache.readThrough("1", 0, supersedes, read(1n))
    vi.advanceTimersByTime(1)
    const item = await cache.readThrough("1", 1, supersedes, read(2n))
    expect(item).toEqual({ state: null, token: { version: 2n, bytes: 0n, value: null } })
    vi.useRealTimers()
  })

  const waiter = () => {
    let resolve!: () => void
    const promise = new Promise<void>((res) => (resolve = res))
    return [promise, resolve] as const
  }

  test("only one reload of a stream is in flight at any given moment", async () => {
    const [w, r] = waiter()
    const reload = vi
      .fn()
      .mockImplementationOnce(async () => {
        await w
        return read(1n)()
      })
      .mockRejectedValue(new Error("Unexpected reload"))

    const cache = new Cache.MemoryCache(2)
    const p1 = cache.readThrough("1", anyValue, supersedes, reload)
    const p2 = cache.readThrough("1", anyValue, supersedes, reload)
    const p3 = cache.readThrough("1", anyValue, supersedes, reload)
    r()
    await Promise.all([p1, p2, p3])
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("compatible overlapping stale reads share the reload", async () => {
    let loadCount = 0
    const [w, r] = waiter()
    const reload = vi.fn(async () => {
      loadCount++
      await w
      return { state: loadCount, token: { version: BigInt(loadCount), bytes: 0n, value: null } }
    })
    const cache = new Cache.MemoryCache(2)
    const p1 = cache.readThrough("1", 0, supersedes, reload)
    const p2 = cache.readThrough("1", 300, supersedes, reload)
    r()
    const expected = { state: 1, token: { version: 1n, bytes: 0n, value: null } }
    await expect(Promise.all([p1, p2])).resolves.toEqual([expected, expected])
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
