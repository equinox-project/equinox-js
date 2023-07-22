import { IStream, TokenAndState, StreamToken, SyncResult } from "./Core.js"
import { trace } from "@opentelemetry/api"

/** Store-agnostic interface representing interactions an Application can have with a set of streams with a given pair of Event and State types */
export interface ICategory<Event, State, Context = null> {
  /** Obtain the state from the target stream */
  load(
    streamId: string,
    allowStale: boolean,
    requireLeader: boolean,
  ): Promise<TokenAndState<State>>

  /**
   * Given the supplied `token` [and related `originState`], attempt to move to state `state'` by appending the supplied `events` to the underlying stream
   * SyncResult.Written: implies the state is now the value represented by the Result's value
   * SyncResult.Conflict: implies the `events` were not synced; if desired the consumer can use the included resync workflow in order to retry
   */
  trySync(
    streamId: string,
    context: Context,
    originToken: StreamToken,
    originState: State,
    events: Event[],
  ): Promise<SyncResult<State>>
}

export class Category<Event, State, Context = null> {
  constructor(
    private readonly inner: ICategory<Event, State, Context>,
    private readonly empty: TokenAndState<State>,
  ) {}

  stream(context: Context, streamId: string): IStream<Event, State> {
    return {
      loadEmpty: () => this.empty,
      load: (allowStale, requireLeader) => {
        trace.getActiveSpan()?.setAttributes({
          "eqx.stream_id": streamId,
          "eqx.require_leader": requireLeader,
          "eqx.allow_stale": allowStale,
        })
        return this.inner.load(streamId, allowStale, requireLeader)
      },
      trySync: (attempt, origin, events) => {
        trace.getActiveSpan()?.setAttributes({
          "eqx.stream_id": streamId,
          "eqx.sync_attempts": attempt,
          "eqx.expected_version": Number(origin.token.version),
          "eqx.append_count": events.length,
        })
        return this.inner.trySync(
          streamId,
          context,
          origin.token,
          origin.state,
          events,
        )
      },
    }
  }
}
