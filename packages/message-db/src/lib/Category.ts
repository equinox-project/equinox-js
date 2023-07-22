import type {
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
import { trace } from "@opentelemetry/api"
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
  constructor(
    public read: MessageDbReader,
    public write: MessageDbWriter,
  ) {}

  static create(pool: Pool, followerPool = pool) {
    return new MessageDbConnection(
      new MessageDbReader(followerPool, pool),
      new MessageDbWriter(pool),
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
    public readonly maxBatches?: number,
  ) {}

  tokenEmpty = Token.create(-1n)

  async loadBatched<Event, State>(
    streamName: string,
    requireLeader: boolean,
    tryDecode: TryDecode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
  ): Promise<[StreamToken, State]> {
    let state = initial
    let version = -1n
    let batches = 0
    let eventCount = 0
    for await (const [lastVersion, events] of Read.loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName,
      0n,
      requireLeader,
    )) {
      batches++
      eventCount += events.length
      state = fold(state, keepMap(events, tryDecode))
      version = lastVersion
    }
    trace.getActiveSpan()?.setAttributes({
      "eqx.loaded_events": eventCount,
      "eqx.loaded_batches": batches,
      "eqx.last_version": Number(version),
    })
    return [Token.create(version), state]
  }

  async loadLast<Event, State>(
    streamName: string,
    requireLeader: boolean,
    tryDecode: TryDecode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
  ): Promise<[StreamToken, State]> {
    const [version, events] = await Read.loadLastEvent(this.conn.read, requireLeader, streamName)
    trace.getActiveSpan()?.setAttributes({
      "eqx.loaded_events": 1,
      "eqx.last_version": Number(version),
    })
    return [Token.create(version), fold(initial, keepMap(events, tryDecode))]
  }

  async loadSnapshot<Event>(
    category: string,
    streamId: string,
    requireLeader: boolean,
    tryDecode: TryDecode<Event>,
    eventType: string,
  ) {
    const snapshotStream = Snapshot.streamName(category, streamId)
    const [, events] = await Read.loadLastEvent(
      this.conn.read,
      requireLeader,
      snapshotStream,
      eventType,
    )
    const decoded = await Snapshot.decode(tryDecode, events)
    trace.getActiveSpan()?.setAttributes({
      "eqx.snapshot_version": decoded ? Number(decoded?.[0].version) : -1,
    })
    return decoded
  }

  async reload<Event, State>(
    streamName: string,
    requireLeader: boolean,
    token: StreamToken,
    tryDecode: TryDecode<Event>,
    fold: (state: State, events: Event[]) => State,
    state: State,
  ): Promise<[StreamToken, State]> {
    let streamVersion = Token.streamVersion(token)
    const startPos = streamVersion + 1n // Reading a stream uses {inclusive} positions, but the streamVersion is `-1`-based
    let batches = 0
    let eventCount = 0
    for await (const [version, events] of Read.loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName,
      startPos,
      requireLeader,
    )) {
      state = fold(state, keepMap(events, tryDecode))
      streamVersion = streamVersion > version ? streamVersion : version
      batches++
      eventCount++
    }
    trace.getActiveSpan()?.setAttributes({
      "eqx.reloaded_events": eventCount,
      "eqx.reloaded_batches": batches,
    })
    return [Token.create(streamVersion), state]
  }

  async trySync(
    streamName: string,
    token: StreamToken,
    encodedEvents: IEventData<Format>[],
  ): Promise<GatewaySyncResult> {
    const span = trace.getActiveSpan()
    const streamVersion = Token.streamVersion(token)
    span?.setAttribute(
      "eqx.append_types",
      encodedEvents.map((x) => x.type),
    )
    const result = await this.conn.write.writeMessages(streamName, encodedEvents, streamVersion)

    switch (result.type) {
      case "ConflictUnknown":
        span?.addEvent("Conflict")
        return { type: "ConflictUnknown" }
      case "Written": {
        const token = Token.create(result.position)
        return { type: "Written", token }
      }
    }
  }

  async storeSnapshot(categoryName: string, streamId: string, event: IEventData<Format>) {
    const snapshotStream = Snapshot.streamName(categoryName, streamId)
    await this.conn.write.writeMessages(snapshotStream, [event], null)
    trace.getActiveSpan()?.setAttribute("eqx.snapshot_written", true)
  }

  static create({ pool, followerPool, batchSize, maxBatches }: ContextConfig) {
    const connection = MessageDbConnection.create(pool, followerPool)
    return new MessageDbContext(connection, batchSize, maxBatches)
  }
}

type AccessStrategy<Event, State> =
  | { type: "Unoptimized" }
  | { type: "LatestKnownEvent" }
  | {
      type: "AdjacentSnapshots"
      eventName: string
      toSnapshot: (state: State) => Event
      frequency?: number
    }

export namespace AccessStrategy {
  export const Unoptimized = <E, S>(): AccessStrategy<E, S> => ({ type: "Unoptimized" })
  export const LatestKnownEvent = <E, S>(): AccessStrategy<E, S> => ({ type: "LatestKnownEvent" })
  export const AdjacentSnapshots = <E, S>(
    eventName: string,
    toSnapshot: (state: S) => E,
    frequency?: number,
  ): AccessStrategy<E, S> => ({
    type: "AdjacentSnapshots",
    eventName,
    toSnapshot,
    frequency,
  })
}

class InternalCategory<Event, State, Context>
  implements IReloadableCategory<Event, State, Context>
{
  constructor(
    private readonly context: MessageDbContext,
    private readonly categoryName: string,
    private readonly codec: ICodec<Event, Format, Context>,
    private readonly fold: (state: State, events: Event[]) => State,
    private readonly initial: State,
    private readonly access: AccessStrategy<Event, State> = AccessStrategy.Unoptimized(),
  ) {}

  private async loadAlgorithm(
    streamId: string,
    requireLeader: boolean,
  ): Promise<[StreamToken, State]> {
    const streamName = Equinox.StreamName.compose(this.categoryName, streamId)
    const span = trace.getActiveSpan()
    span?.setAttributes({
      "eqx.access_strategy": this.access.type,
      "eqx.category": this.categoryName,
      "eqx.stream_name": streamName,
    })
    switch (this.access.type) {
      case "Unoptimized":
        return this.context.loadBatched(
          streamName,
          requireLeader,
          this.codec.tryDecode,
          this.fold,
          this.initial,
        )
      case "LatestKnownEvent":
        return this.context.loadLast(
          streamName,
          requireLeader,
          this.codec.tryDecode,
          this.fold,
          this.initial,
        )
      case "AdjacentSnapshots": {
        const result = await this.context.loadSnapshot(
          this.categoryName,
          streamId,
          requireLeader,
          this.codec.tryDecode,
          this.access.eventName,
        )
        if (!result)
          return this.context.loadBatched(
            streamName,
            requireLeader,
            this.codec.tryDecode,
            this.fold,
            this.initial,
          )
        const [pos, snapshotEvent] = result
        const initial = this.fold(this.initial, [snapshotEvent])
        const [token, state] = await this.context.reload(
          streamName,
          requireLeader,
          pos,
          this.codec.tryDecode,
          this.fold,
          initial,
        )
        return [Token.withSnapshot(token, pos.version), state]
      }
    }
  }

  supersedes = Token.supersedes

  async load(streamId: string, requireLeader: boolean) {
    const [token, state] = await this.loadAlgorithm(streamId, requireLeader)
    return { token, state }
  }

  async reload(streamId: string, requireLeader: boolean, t: TokenAndState<State>) {
    const streamName = Equinox.StreamName.compose(this.categoryName, streamId)
    const [token, state] = await this.context.reload(
      streamName,
      requireLeader,
      t.token,
      this.codec.tryDecode,
      this.fold,
      t.state,
    )
    return { token, state }
  }

  async trySync(
    streamId: string,
    ctx: Context,
    token: StreamToken,
    state: State,
    events: Event[],
  ): Promise<SyncResult<State>> {
    const span = trace.getActiveSpan()
    const streamName = Equinox.StreamName.compose(this.categoryName, streamId)
    span?.setAttributes({
      "eqx.category": this.categoryName,
      "eqx.stream_name": streamName,
    })
    const encode = (ev: Event) => this.codec.encode(ev, ctx)
    const encodedEvents = await Promise.all(events.map(encode))
    const result = await this.context.trySync(streamName, token, encodedEvents)
    switch (result.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(streamId, true, { token, state }),
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
                this.categoryName,
                streamId,
                ctx,
                result.token,
                this.access.toSnapshot(newState),
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
    snapshotEvent: Event,
  ) {
    const event = this.codec.encode(snapshotEvent, ctx)
    event.meta = JSON.stringify(Snapshot.meta(token))
    await this.context.storeSnapshot(category, streamId, event)
  }
}

export class MessageDbCategory {
  static create<Event, State, Context = null>(
    context: MessageDbContext,
    categoryName: string,
    codec: ICodec<Event, Format, Context>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
    caching: ICachingStrategy = CachingStrategy.noCache(),
    access?: AccessStrategy<Event, State>,
  ) {
    const inner = new InternalCategory(context, categoryName, codec, fold, initial, access)
    const category = CachingCategory.apply(categoryName, inner, caching)
    const empty: TokenAndState<State> = { token: context.tokenEmpty, state: initial }
    return new Equinox.Category(category, empty)
  }
}
