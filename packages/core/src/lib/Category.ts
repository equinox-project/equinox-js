import { IStream, TokenAndState, StreamToken, SyncResult } from "./Core.js"
import { trace } from "@opentelemetry/api"
import * as Tags from './Tags.js'
import { StreamId } from "./StreamId.js"

/** Store-agnostic interface representing interactions an Application can have with a set of streams with a given pair of Event and State types */
export interface ICategory<Event, State, Context = undefined> {
  /** Obtain the state from the target stream */
  load(streamId: StreamId, maxStaleMs: number, requireLeader: boolean): Promise<TokenAndState<State>>

  /**
   * Given the supplied `token` [and related `originState`], attempt to move to state `state'` by appending the supplied `events` to the underlying stream
   * SyncResult.Written: implies the state is now the value represented by the Result's value
   * SyncResult.Conflict: implies the `events` were not synced; if desired the consumer can use the included resync workflow in order to retry
   */
  sync(
    streamId: StreamId,
    context: Context,
    originToken: StreamToken,
    originState: State,
    events: Event[],
  ): Promise<SyncResult<State>>
}

export class Category<Event, State, Context = undefined> {
  constructor(
    private readonly inner: ICategory<Event, State, Context>,
    private readonly empty: TokenAndState<State>,
  ) {}

  stream(context: Context, streamId: StreamId): IStream<Event, State> {
    return {
      loadEmpty: () => this.empty,
      load: (maxStaleMs, requireLeader) => {
        trace.getActiveSpan()?.setAttributes({
          [Tags.stream_id]: streamId,
          [Tags.requires_leader]: requireLeader,
          [Tags.cache_hit]: false,
          [Tags.allow_stale]: maxStaleMs == Number.MAX_SAFE_INTEGER,
        })
        return this.inner.load(streamId, maxStaleMs, requireLeader)
      },
      sync: (attempt, origin, events) => {
        trace.getActiveSpan()?.setAttributes({
          [Tags.stream_id]: streamId,
          [Tags.sync_retries]: attempt > 1 ? attempt - 1 : undefined,
          [Tags.append_count]: events.length,
        })
        return this.inner.sync(streamId, context, origin.token, origin.state, events)
      },
    }
  }
}
