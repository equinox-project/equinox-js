import { IStream, queryAsync, TokenAndState, transactAsync } from "./Core.js"
import { Category } from "./Category.js"

export enum LoadOption {
  /** Default policy; Obtain the latest state from store based on consistency level configured */
  RequireLoad,
  /** Request that data be read with a quorum read / from a Leader connection */
  RequireLeader,
  /**
   * If the Cache holds any state, use that without checking the backing store for updates, implying:
   * - maximizing how much we lean on Optimistic Concurrency Control when doing a `Transact` (you're still guaranteed a consistent outcome)
   * - enabling stale reads [in the face of multiple writers (either in this process or in other processes)] when doing a `Query`
   */
  AllowStale,
  /** Inhibit load from database based on the fact that the stream is likely not to have been initialized yet, and we will be generating events */
  AssumeEmpty,
}

namespace LoadPolicy {
  export function fetch<State, Event>(
    x?: LoadOption,
  ): (stream: IStream<Event, State>) => Promise<TokenAndState<State>> {
    switch (x) {
      case LoadOption.RequireLoad:
      case undefined:
      case null:
        return (stream) => stream.load(false, false)
      case LoadOption.RequireLeader:
        return (stream) => stream.load(false, true)
      case LoadOption.AllowStale:
        return (stream) => stream.load(true, false)
      case LoadOption.AssumeEmpty:
        return (stream) => Promise.resolve(stream.loadEmpty())
    }
  }
}

export class MaxResyncsExhaustedException extends Error {
  constructor(count: number) {
    super(`Concurrency violation; aborting after ${count} attempts.`)
  }
}

namespace AttemptsPolicy {
  export function validate(opt?: number) {
    const maxAttempts = opt == null ? 3 : opt
    if (maxAttempts < 1) throw new Error("Attempts must be at least 1")
    return (attempt: number) => {
      if (attempt === maxAttempts) throw new MaxResyncsExhaustedException(attempt)
    }
  }
}

export interface ISyncContext<State> {
  /**
   * Exposes the underlying Store's internal Version for the underlying stream.
   * An empty stream is Version 0; one with a single event is Version 1 etc.
   * It's important to consider that this Version is more authoritative than counting the events seen, or adding 1 to
   *   the `Index` of the last event passed to your `fold` function - the codec may opt to ignore events
   */
  version: bigint

  /**
   * The Storage occupied by the Events written to the underlying stream at the present time.
   * Specific stores may vary whether this is available, the basis and preciseness for how it is computed.
   */
  streamEventBytes?: bigint

  /** The present State of the stream within the context of this Flow */
  state: State
}

namespace SyncContext {
  export const map = <State>(ctx: TokenAndState<State>): ISyncContext<State> => ({
    state: ctx.state,
    version: ctx.token.version,
    streamEventBytes: ctx.token.bytes === -1n ? undefined : ctx.token.bytes,
  })
}

export class Decider<Event, State> {
  constructor(private readonly stream: IStream<Event, State>) {}

  /**
   * 1.  Invoke the supplied `interpret` function with the present state to determine whether any write is to occur.
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *    (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   */
  transact(
    interpret: (state: State) => Event[],
    load?: LoadOption,
    attempts?: number,
  ): Promise<void> {
    const decide = ({ state }: TokenAndState<State>): Promise<[null, Event[]]> =>
      Promise.resolve([null, interpret(state)])
    const mapRes = () => undefined
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      decide,
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `interpret` function with the present state
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *    (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Uses `render` to generate a 'view from the persisted final state
   */
  transactProject<View>(
    interpret: (state: State) => Event[],
    render: (state: State) => View,
    load?: LoadOption,
    attempts?: number,
  ): Promise<View> {
    const decide = ({ state }: TokenAndState<State>): Promise<[null, Event[]]> =>
      Promise.resolve([null, interpret(state)])
    const mapRes = (_result: null, { state }: TokenAndState<State>) => render(state)
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      decide,
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `decide` function with the present state, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *    (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yield result
   */
  transactResult<Result>(
    interpret: (state: State) => [Result, Event[]],
    load?: LoadOption,
    attempts?: number,
  ): Promise<Result> {
    const decide = ({ state }: TokenAndState<State>): Promise<[Result, Event[]]> =>
      Promise.resolve(interpret(state))
    const mapRes = (result: Result) => result
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      decide,
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `decide` function with the present state, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *    (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yields a final `View` produced by `mapResult` from the `'result` and/or the final persisted `'state`
   */
  transactMapResult<Result, View>(
    interpret: (state: State) => [Result, Event[]],
    mapResult: (result: Result, state: State) => View,
    load?: LoadOption,
    attempts?: number,
  ): Promise<View> {
    const decide = ({ state }: TokenAndState<State>): Promise<[Result, Event[]]> =>
      Promise.resolve(interpret(state))
    const mapRes = (result: Result, { state }: TokenAndState<State>) => mapResult(result, state)
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      decide,
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `decide` function with the current complete context, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *   (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yields `result`
   */
  transactEx<Result>(
    decide: (state: ISyncContext<State>) => [Result, Event[]],
    load?: LoadOption,
    attempts?: number,
  ): Promise<Result> {
    const decide_ = (t: TokenAndState<State>) => Promise.resolve(decide(SyncContext.map(t)))
    const mapRes = (res: Result) => res
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      decide_,
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `decide` function with the current complete context, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *   (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yields a final 'view produced by `mapResult` from the `'result` and/or the final persisted `ISyncContext`
   */
  transactExMapResult<Result, View>(
    decide: (state: ISyncContext<State>) => [Result, Event[]],
    mapResult: (result: Result, ctx: ISyncContext<State>) => View,
    load?: LoadOption,
    attempts?: number,
  ): Promise<View> {
    const decide_ = (t: TokenAndState<State>) => Promise.resolve(decide(SyncContext.map(t)))
    const mapRes = (res: Result, t: TokenAndState<State>) => mapResult(res, SyncContext.map(t))
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      decide_,
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /** Project from the folded `'state`, but without executing a decision flow as `Transact` does */
  query<View>(render: (state: State) => View, load?: LoadOption): Promise<View> {
    return queryAsync(this.stream, LoadPolicy.fetch(load), ({ state }) => render(state))
  }

  /** Project from the stream's complete context, but without executing a decision flow as `TransactEx` does */
  queryEx<View>(render: (ctx: ISyncContext<State>) => View, load?: LoadOption): Promise<View> {
    return queryAsync(this.stream, LoadPolicy.fetch(load), (t) => render(SyncContext.map(t)))
  }

  /**
   * 1. Invoke the supplied `Async` `interpret` function with the present state
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *   (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Uses `render` to generate a 'view from the persisted final state
   */
  transactAsync(
    interpret: (state: State) => Promise<Event[]>,
    load?: LoadOption,
    attempts?: number,
  ): Promise<void> {
    const mapRes = () => undefined
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      ({ state }) => interpret(state).then((s) => [null, s]),
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `Async` `decide` function with the present state, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *   (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yield result
   */
  transactResultAsync<Result>(
    decide: (state: State) => Promise<[Result, Event[]]>,
    load?: LoadOption,
    attempts?: number,
  ): Promise<Result> {
    const mapRes = (res: Result) => res
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      ({ state }) => decide(state),
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `Async` `decide` function with the current complete context, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *   (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yield result
   */
  transactExAsync<Result>(
    decide: (state: ISyncContext<State>) => Promise<[Result, Event[]]>,
    load?: LoadOption,
    attempts?: number,
  ): Promise<Result> {
    const mapRes = (res: Result) => res
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      (x) => decide(SyncContext.map(x)),
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  /**
   * 1. Invoke the supplied `Async` `decide` function with the current complete context, holding the `'result`
   * 2. (if events yielded) Attempt to sync the yielded events to the stream.
   *    (Restarts up to `maxAttempts` times with updated state per attempt, throwing `MaxResyncsExhaustedException` on failure of final attempt.)
   * 3. Yields a final 'view produced by `mapResult` from the `'result` and/or the final persisted `ISyncContext`
   */
  transactExMapResultAsync<Result, View>(
    decide: (state: ISyncContext<State>) => Promise<[Result, Event[]]>,
    mapResult: (result: Result, ctx: ISyncContext<State>) => View,
    load?: LoadOption,
    attempts?: number,
  ): Promise<View> {
    const mapRes = (res: Result, x: TokenAndState<State>) => mapResult(res, SyncContext.map(x))
    return transactAsync(
      this.stream,
      LoadPolicy.fetch(load),
      (x) => decide(SyncContext.map(x)),
      AttemptsPolicy.validate(attempts),
      mapRes,
    )
  }

  static resolve<E, S, C>(category: Category<E, S, C>, streamId: string, context: C) {
    return new Decider(category.stream(context, streamId))
  }
}
