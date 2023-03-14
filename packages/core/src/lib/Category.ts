import { IStream, TokenAndState, StreamToken, SyncResult } from "./Core.js"
import { SpanKind } from "@opentelemetry/api"
import { tracer } from "./Tracing.js"

/** Store-agnostic interface representing interactions an Application can have with a set of streams with a given pair of Event and State types */
export interface ICategory<Event, State, Context = null> {
  /** Obtain the state from the target stream */
  load(categoryName: string, streamId: string, streamName: string, allowStale: boolean, requireLeader: boolean): Promise<TokenAndState<State>>

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
    events: Event[]
  ): Promise<SyncResult<State>>
}

export class Category<Event, State, Context = null> {
  constructor(
    private readonly resolveInner: (categoryName: string, streamId: string) => readonly [ICategory<Event, State, Context>, string],
    private readonly empty: TokenAndState<State>
  ) {}

  stream(context: Context, categoryName: string, streamId: string): IStream<Event, State> {
    const [inner, streamName] = this.resolveInner(categoryName, streamId)
    return {
      loadEmpty: () => this.empty,
      load: (allowStale, requireLeader) =>
        tracer.startActiveSpan(
          "Load",
          {
            kind: SpanKind.CLIENT,
            attributes: {
              "eqx.stream_name": streamName,
              "eqx.stream_id": streamId,
              "eqx.category": categoryName,
              "eqx.requires_leader": requireLeader,
              "eqx.allow_stale": allowStale,
            },
          },
          (span) => inner.load(categoryName, streamId, streamName, allowStale, requireLeader).finally(() => span.end())
        ),
      trySync: (attempt, origin, events) =>
        tracer.startActiveSpan(
          "TrySync",
          {
            kind: SpanKind.CLIENT,
            attributes: {
              "eqx.stream_name": streamName,
              "eqx.stream_id": streamId,
              "eqx.category": categoryName,
              "eqx.resync_count": attempt > 1 ? attempt - 1 : undefined,
            },
          },
          (span) => inner.trySync(categoryName, streamId, streamName, context, origin.token, origin.state, events).finally(() => span.end())
        ),
    }
  }
}
