import { IStream, TokenAndState, StreamToken, SyncResult } from "./Core.js"
import { trace } from "@opentelemetry/api"

/** Store-agnostic interface representing interactions an Application can have with a set of streams with a given pair of Event and State types */
export interface ICategory<Event, State, Context = null> {
  /** Obtain the state from the target stream */
  load(
    categoryName: string,
    streamId: string,
    streamName: string,
    allowStale: boolean,
    requireLeader: boolean,
  ): Promise<TokenAndState<State>>

  /**
   * Given the supplied `token` [and related `originState`], attempt to move to state `state'` by appending the supplied `events` to the underlying stream
   * SyncResult.Written: implies the state is now the value represented by the Result's value
   * SyncResult.Conflict: implies the `events` were not synced; if desired the consumer can use the included resync workflow in order to retry
   */
  trySync(
    categoryName: string,
    streamId: string,
    streamName: string,
    context: Context,
    originToken: StreamToken,
    originState: State,
    events: Event[],
  ): Promise<SyncResult<State>>
}

export class Category<Event, State, Context = null> {
  constructor(
    private readonly resolveInner: (
      categoryName: string,
      streamId: string,
    ) => readonly [ICategory<Event, State, Context>, string],
    private readonly empty: TokenAndState<State>,
  ) {}

  stream(context: Context, categoryName: string, streamId: string): IStream<Event, State> {
    const [inner, streamName] = this.resolveInner(categoryName, streamId)
    return {
      loadEmpty: () => this.empty,
      load: (allowStale, requireLeader) => {
        trace.getActiveSpan()?.setAttributes({
          "eqx.stream_name": streamName,
          "eqx.stream_id": streamId,
          "eqx.category": categoryName,
          "eqx.require_leader": requireLeader,
          "eqx.allow_stale": allowStale,
        })
        return inner.load(categoryName, streamId, streamName, allowStale, requireLeader)
      },
      trySync: (attempt, origin, events) => {
        trace.getActiveSpan()?.setAttributes({
          "eqx.stream_name": streamName,
          "eqx.stream_id": streamId,
          "eqx.category": categoryName,
          "eqx.sync_attempts": attempt,
          "eqx.expected_version": Number(origin.token.version),
          "eqx.append_count": events.length,
        })
        return inner.trySync(
          categoryName,
          streamId,
          streamName,
          context,
          origin.token,
          origin.state,
          events,
        )
      },
    }
  }
}
