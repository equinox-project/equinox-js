import type {
  ICategory,
  IEventData,
  StreamToken,
  SyncResult,
  ITimelineEvent,
  TokenAndState,
  ICodec,
} from "@equinox-js/core"
import * as Equinox from "@equinox-js/core"
import * as Token from "./Token.js"
import * as Snapshot from "./Snapshot.js"
import * as Read from "./Read.js"
import { SpanStatusCode, trace } from "@opentelemetry/api"
import { Format, MessageDbReader, MessageDbWriter } from "./MessageDbClient.js"
import { Pool } from "pg"
import {
  CachingCategory,
  CachingStrategy,
  ICachingStrategy,
  IReloadableCategory,
} from "@equinox-js/core"

function keepMap<T, V>(arr: T[], fn: (v: T) => V | undefined): V[] {
  const result: V[] = []
  for (let i = 0; i < arr.length; ++i) {
    const value = fn(arr[i])
    if (value != null) result.push(value)
  }
  return result
}

type GatewaySyncResult = { type: "Written"; token: StreamToken } | { type: "ConflictUnknown" }

type TryDecode<E> = (v: ITimelineEvent<Format>) => E | undefined

export class MessageDbConnection {
  constructor(public read: MessageDbReader, public write: MessageDbWriter) {}

  static create(pool: Pool, followerPool = pool) {
    return new MessageDbConnection(
      new MessageDbReader(followerPool, pool),
      new MessageDbWriter(pool)
    )
  }
}

type ContextConfig = {
  pool: Pool
  followerPool?: Pool
  batchSize: number
  maxBatches?: number
}

export class MessageDbContext {
  constructor(
    private readonly conn: MessageDbConnection,
    public readonly batchSize: number,
    public readonly maxBatches?: number
  ) {}

  tokenEmpty = Token.create(-1n)

  async loadBatched<Event>(
    streamName: string,
    requireLeader: boolean,
    tryDecode: TryDecode<Event>
  ): Promise<[StreamToken, Event[]]> {
    const [version, events] = await Read.loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName,
      0n,
      requireLeader
    )
    return [Token.create(version), keepMap(events, tryDecode)]
  }

  async loadLast<Event>(
    streamName: string,
    requireLeader: boolean,
    tryDecode: TryDecode<Event>
  ): Promise<[StreamToken, Event[]]> {
    const [version, events] = await Read.loadLastEvent(this.conn.read, requireLeader, streamName)
    return [Token.create(version), keepMap(events, tryDecode)]
  }

  async loadSnapshot<Event>(
    category: string,
    streamId: string,
    requireLeader: boolean,
    tryDecode: TryDecode<Event>,
    eventType: string
  ) {
    const snapshotStream = Snapshot.streamName(category, streamId)
    const [, events] = await Read.loadLastEvent(
      this.conn.read,
      requireLeader,
      snapshotStream,
      eventType
    )
    return Snapshot.decode(tryDecode, events)
  }

  async reload<Event>(
    streamName: string,
    requireLeader: boolean,
    token: StreamToken,
    tryDecode: TryDecode<Event>
  ): Promise<[StreamToken, Event[]]> {
    const streamVersion = Token.streamVersion(token)
    const startPos = streamVersion + 1n // Reading a stream uses {inclusive} positions, but the streamVersion is `-1`-based
    const [version, events] = await Read.loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName,
      startPos,
      requireLeader
    )
    return [
      Token.create(streamVersion > version ? streamVersion : version),
      keepMap(events, tryDecode),
    ]
  }

  async trySync(
    category: string,
    streamId: string,
    streamName: string,
    token: StreamToken,
    encodedEvents: IEventData<Format>[]
  ): Promise<GatewaySyncResult> {
    const streamVersion = Token.streamVersion(token)
    const result = await this.conn.write.writeMessages(streamName, encodedEvents, streamVersion)

    switch (result.type) {
      case "ConflictUnknown":
        const span = trace.getActiveSpan()
        span?.setStatus({ code: SpanStatusCode.ERROR, message: "ConflictUnknown" })
        return { type: "ConflictUnknown" }
      case "Written": {
        const token = Token.create(result.position)
        return { type: "Written", token }
      }
    }
  }

  async storeSnapshot(categoryName: string, streamId: string, event: IEventData<Format>) {
    const snapshotStream = Snapshot.streamName(categoryName, streamId)
    return this.conn.write.writeMessages(snapshotStream, [event], null)
  }

  static create({ pool, followerPool, batchSize, maxBatches }: ContextConfig) {
    const connection = MessageDbConnection.create(pool, followerPool)
    return new MessageDbContext(connection, batchSize, maxBatches)
  }
}

type AccessStrategy<Event, State> =
  | { type: "Unoptimized" }
  | { type: "LatestKnownEvent" }
  | { type: "AdjacentSnapshots"; eventName: string; toSnapshot: (state: State) => Event, frequency?: number }

export namespace AccessStrategy {
  export const Unoptimized = <E, S>(): AccessStrategy<E, S> => ({ type: "Unoptimized" })
  export const LatestKnownEvent = <E, S>(): AccessStrategy<E, S> => ({ type: "LatestKnownEvent" })
  export const AdjacentSnapshots = <E, S>(
    eventName: string,
    toSnapshot: (state: S) => E,
    frequency?: number
  ): AccessStrategy<E, S> => ({
    type: "AdjacentSnapshots",
    eventName,
    toSnapshot,
    frequency
  })
}

class InternalCategory<Event, State, Context>
  implements IReloadableCategory<Event, State, Context>
{
  constructor(
    private readonly context: MessageDbContext,
    private readonly codec: ICodec<Event, Format, Context>,
    private readonly fold: (state: State, events: Event[]) => State,
    private readonly initial: State,
    private readonly access: AccessStrategy<Event, State> = AccessStrategy.Unoptimized()
  ) {}

  private async loadAlgorithm(
    category: string,
    streamId: string,
    streamName: string,
    requireLeader: boolean
  ): Promise<[StreamToken, Event[]]> {
    const span = trace.getActiveSpan()
    switch (this.access?.type) {
      case "Unoptimized":
        return this.context.loadBatched(streamName, requireLeader, this.codec.tryDecode)
      case "LatestKnownEvent":
        return this.context.loadLast(streamName, requireLeader, this.codec.tryDecode)
      case "AdjacentSnapshots": {
        const result = await this.context.loadSnapshot(
          category,
          streamId,
          requireLeader,
          this.codec.tryDecode,
          this.access.eventName
        )
        span?.setAttributes({
          "eqx.snapshot_version": result ? String(result[0].version) : String(-1),
        })
        if (!result)
          return this.context.loadBatched(streamName, requireLeader, this.codec.tryDecode)
        const [pos, snapshotEvent] = result
        const [token, rest] = await this.context.reload(
          streamName,
          requireLeader,
          pos,
          this.codec.tryDecode
        )
        return [Token.withSnapshot(token, pos.version), [snapshotEvent].concat(rest)]
      }
    }
  }

  supersedes = Token.supersedes

  async load(category: string, streamId: string, streamName: string, requireLeader: boolean) {
    const [token, events] = await this.loadAlgorithm(category, streamId, streamName, requireLeader)
    return { token, state: this.fold(this.initial, events) }
  }

  async reload(streamName: string, requireLeader: boolean, t: TokenAndState<State>) {
    const [token, events] = await this.context.reload(
      streamName,
      requireLeader,
      t.token,
      this.codec.tryDecode
    )
    return { token, state: this.fold(t.state, events) }
  }

  async trySync(
    category: string,
    streamId: string,
    streamName: string,
    ctx: Context,
    token: StreamToken,
    state: State,
    events: Event[]
  ): Promise<SyncResult<State>> {
    const span = trace.getActiveSpan()
    const encode = (ev: Event) => this.codec.encode(ev, ctx)
    const encodedEvents = await Promise.all(events.map(encode))
    const result = await this.context.trySync(category, streamId, streamName, token, encodedEvents)
    switch (result.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(streamName, true, { token, state }),
        }
      case "Written": {
        const newState = this.fold(state, events)
        switch (this.access.type) {
          case "LatestKnownEvent":
          case "Unoptimized":
            break
          case "AdjacentSnapshots": {
            const shapshotFrequency = this.access.frequency ?? this.context.batchSize
            const shouldSnapshot = Token.shouldSnapshot(shapshotFrequency, token, result.token)
            span?.setAttribute("eqx.should_snapshot", shouldSnapshot)
            if (shouldSnapshot) {
              await this.storeSnapshot(
                category,
                streamId,
                ctx,
                result.token,
                this.access.toSnapshot(newState)
              )
            }
          }
        }
        return { type: "Written", data: { token: result.token, state: newState } }
      }
    }
  }

  async storeSnapshot(
    category: string,
    streamId: string,
    ctx: Context,
    token: StreamToken,
    snapshotEvent: Event
  ) {
    const event = this.codec.encode(snapshotEvent, ctx)
    event.meta = JSON.stringify(Snapshot.meta(token))
    await this.context.storeSnapshot(category, streamId, event)
  }
}

export class MessageDbCategory<Event, State, Context = null> extends Equinox.Category<
  Event,
  State,
  Context
> {
  constructor(
    resolveInner: (
      categoryName: string,
      streamId: string
    ) => readonly [ICategory<Event, State, Context>, string],
    empty: TokenAndState<State>
  ) {
    super(resolveInner, empty)
  }

  static create<Event, State, Context = null>(
    context: MessageDbContext,
    codec: ICodec<Event, Format, Context>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
    caching: ICachingStrategy = CachingStrategy.noCache(),
    access?: AccessStrategy<Event, State>
  ) {
    const inner = new InternalCategory(context, codec, fold, initial, access)
    const category = CachingCategory.apply(inner, caching)
    const resolveInner = (categoryName: string, streamId: string) =>
      [category, `${categoryName}-${streamId}`] as const
    const empty: TokenAndState<State> = { token: context.tokenEmpty, state: initial }
    return new MessageDbCategory(resolveInner, empty)
  }
}
