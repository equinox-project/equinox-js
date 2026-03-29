import { describe, test, expect, vi } from "vitest"
import {
  Decider,
  IStream,
  LoadOption,
  MaxResyncsExhaustedException,
  StreamToken,
  SyncResult,
  TokenAndState,
} from "../src"

type TestEvent = { type: "Increment"; amount: number }

const token = (version: bigint, bytes = 0n): StreamToken => ({ value: null, version, bytes })

class TestStream implements IStream<TestEvent, number> {
  constructor(
    private readonly empty: TokenAndState<number>,
    private readonly onLoad: (
      maxStaleMs: number,
      requireLeader: boolean,
    ) => Promise<TokenAndState<number>>,
    private readonly onSync: (
      attempt: number,
      origin: TokenAndState<number>,
      events: TestEvent[],
    ) => Promise<SyncResult<number>>,
  ) {}

  loadEmpty(): TokenAndState<number> {
    return this.empty
  }

  load(maxStaleMs: number, requireLeader: boolean): Promise<TokenAndState<number>> {
    return this.onLoad(maxStaleMs, requireLeader)
  }

  sync(
    attempt: number,
    originTokenAndState: TokenAndState<number>,
    events: TestEvent[],
  ): Promise<SyncResult<number>> {
    return this.onSync(attempt, originTokenAndState, events)
  }
}

describe("Decider", () => {
  test("retries with resynced state after a conflict", async () => {
    const seenStates: number[] = []
    const syncAttempts: number[] = []
    const initial = { token: token(0n), state: 0 }
    const resynced = { token: token(1n), state: 1 }

    const stream = new TestStream(
      initial,
      () => Promise.resolve(initial),
      async (attempt, origin, events) => {
        syncAttempts.push(attempt)
        if (attempt === 1) {
          return {
            type: "Conflict",
            resync: async () => resynced,
          }
        }

        const state = origin.state + events.reduce((sum, event) => sum + event.amount, 0)
        return { type: "Written", data: { token: token(2n), state } }
      },
    )

    const decider = new Decider(stream)
    const version = await decider.transactVersion((state) => {
      seenStates.push(state)
      return [{ type: "Increment", amount: 1 }]
    })

    expect(version).toBe(2n)
    expect(seenStates).toEqual([0, 1])
    expect(syncAttempts).toEqual([1, 2])
  })

  test("stops retrying when max attempts are exhausted", async () => {
    const finalResync = vi.fn(async () => ({ token: token(2n), state: 2 }))
    const stream = new TestStream(
      { token: token(0n), state: 0 },
      () => Promise.resolve({ token: token(0n), state: 0 }),
      async (attempt) => ({
        type: "Conflict",
        resync: attempt === 1 ? async () => ({ token: token(1n), state: 1 }) : finalResync,
      }),
    )

    const decider = new Decider(stream)

    await expect(
      decider.transact(() => [{ type: "Increment", amount: 1 }], undefined, 2),
    ).rejects.toBeInstanceOf(MaxResyncsExhaustedException)
    expect(finalResync).not.toHaveBeenCalled()
  })

  test("AssumeEmpty uses loadEmpty instead of loading from the store", async () => {
    const load = vi.fn(async () => ({ token: token(999n), state: 999 }))
    const loadEmpty = { token: token(0n), state: 41 }
    const stream = new TestStream(loadEmpty, load, async () => {
      throw new Error("sync should not be called")
    })
    const decider = new Decider(stream)

    const result = await decider.query((state) => state + 1, LoadOption.AssumeEmpty)

    expect(result).toBe(42)
    expect(load).not.toHaveBeenCalled()
  })

  test("passes load policy flags through to the stream", async () => {
    const load = vi.fn(async (maxStaleMs: number, requireLeader: boolean) => ({
      token: token(5n),
      state: requireLeader ? maxStaleMs : -1,
    }))
    const stream = new TestStream({ token: token(0n), state: 0 }, load, async () => {
      throw new Error("sync should not be called")
    })
    const decider = new Decider(stream)

    const leaderResult = await decider.query((state) => state, LoadOption.RequireLeader)
    const staleResult = await decider.query((state) => state, LoadOption.MaxStale(123))

    expect(leaderResult).toBe(0)
    expect(staleResult).toBe(-1)
    expect(load.mock.calls).toEqual([
      [0, true],
      [123, false],
    ])
  })

  test("queryEx exposes sync context and hides unknown byte counts", async () => {
    const stream = new TestStream(
      { token: token(0n), state: 0 },
      async () => ({ token: token(7n, -1n), state: 42 }),
      async () => {
        throw new Error("sync should not be called")
      },
    )
    const decider = new Decider(stream)

    const result = await decider.queryEx((ctx) => ctx, LoadOption.RequireLoad)

    expect(result).toEqual({
      version: 7n,
      streamEventBytes: undefined,
      state: 42,
    })
  })
})
