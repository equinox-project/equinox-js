import { IStream, TokenAndState, StreamToken, SyncResult } from "./Core.js"
import { trace } from "@opentelemetry/api"
import { Tags } from "../index.js"

/** Store-agnostic interface representing interactions an Application can have with a set of streams with a given pair of Event and State types */
export interface ICategory<Event, State, Context = null> {
  /** Obtain the state from the target stream */
  load(streamId: string, allowStale: boolean, requireLeader: boolean): Promise<TokenAndState<State>>

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
          [Tags.stream_id]: streamId,
          [Tags.requires_leader]: requireLeader,
          [Tags.allow_stale]: allowStale,
        })
        return this.inner.load(streamId, allowStale, requireLeader)
      },
      trySync: (attempt, origin, events) => {
        trace.getActiveSpan()?.setAttributes({
          [Tags.stream_id]: streamId,
          [Tags.sync_retries]: attempt > 1 ? attempt - 1 : undefined,
          [Tags.append_count]: events.length,
        })
        return this.inner.trySync(streamId, context, origin.token, origin.state, events)
      },
    }
  }
}
