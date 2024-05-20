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
import { Client, Pool } from "pg"
import { CachingCategory, ICachingStrategy, IReloadableCategory, Tags } from "@equinox-js/core"

const keepMap = Equinox.Internal.keepMap

type MdbSyncResult = { type: "Written"; token: StreamToken } | { type: "ConflictUnknown" }

type Decode<E> = (v: ITimelineEvent<Format>) => E | undefined

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
  leaderPool: Pool
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

  tokenEmpty = Token.create(0n)

  async loadBatched<Event, State>(
    streamName: string,
    requireLeader: boolean,
    decode: Decode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
    version: bigint,
  ): Promise<TokenAndState<State>> {
    let state = initial
    const { conn, batchSize, maxBatches } = this
    // prettier-ignore
    const iterator = Read.loadForwardsFrom(conn.read, batchSize, maxBatches, streamName, version, requireLeader)
    for await (const [lastVersion, events] of iterator) {
      state = fold(state, keepMap(events, decode))
      version = lastVersion
    }

    return { token: Token.create(version), state }
  }

  async loadLast<Event, State>(
    streamName: string,
    requireLeader: boolean,
    decode: Decode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
  ): Promise<TokenAndState<State>> {
    const [version, events] = await Read.loadLastEvent(this.conn.read, requireLeader, streamName)
    return { token: Token.create(version), state: fold(initial, keepMap(events, decode)) }
  }

  async loadSnapshot<Event>(
    category: string,
    streamId: string,
    requireLeader: boolean,
    decode: Decode<Event>,
    eventType: string,
  ) {
    const snapshotStream = Snapshot.streamName(category, streamId)
    // prettier-ignore
    const [, events] = await Read.loadLastEvent(this.conn.read, requireLeader, snapshotStream, eventType)
    const decoded = Snapshot.decode(decode, events)
    trace.getActiveSpan()?.setAttributes({
      [Tags.snapshot_version]: decoded ? Number(decoded?.[0].version) : 0,
    })
    return decoded
  }

  async sync(
    streamName: string,
    token: StreamToken,
    encodedEvents: IEventData<Format>[],
    runAfter?: (conn: Client) => Promise<void>,
  ): Promise<MdbSyncResult> {
    const span = trace.getActiveSpan()
    const version = Token.version(token)
    const appendedTypes = encodedEvents.map((x) => x.type)
    const spanTypes = appendedTypes.length < 10 ? appendedTypes : uniq(appendedTypes)
    span?.setAttribute(Tags.append_types, spanTypes)
    // prettier-ignore
    const result = await this.conn.write.writeMessages(streamName, encodedEvents, version, runAfter)

    switch (result.type) {
      case "ConflictUnknown":
        span?.addEvent("Conflict")
        return { type: "ConflictUnknown" }
      case "Written": {
        const token = Token.create(result.version)
        return { type: "Written", token }
      }
    }
  }

  async storeSnapshot(categoryName: string, streamId: string, event: IEventData<Format>) {
    const snapshotStream = Snapshot.streamName(categoryName, streamId)
    await this.conn.write.writeMessages(snapshotStream, [event], null)
    trace.getActiveSpan()?.setAttribute(Tags.snapshot_written, true)
  }

  static create({ leaderPool, followerPool, batchSize, maxBatches }: ContextConfig) {
    const connection = MessageDbConnection.create(leaderPool, followerPool)
    return new MessageDbContext(connection, batchSize, maxBatches)
  }
}

export type OnSync<State> = (
  conn: Client,
  streamId: Equinox.StreamId,
  state: State,
  version: bigint,
) => Promise<void>

export type AccessStrategy<Event, State> =
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
    private readonly onSync?: OnSync<State>,
  ) {}

  // prettier-ignore
  private async loadAlgorithm(
    streamId: Equinox.StreamId,
    requireLeader: boolean,
    initial: State,
    version = 0n,
  ): Promise<TokenAndState<State>> {
    const streamName = Equinox.StreamName.create(this.categoryName, streamId)
    const span = trace.getActiveSpan()
    span?.setAttributes({
      [Tags.access_strategy]: this.access.type,
      [Tags.category]: this.categoryName,
      [Tags.stream_name]: streamName,
    })
    switch (this.access.type) {
      case "Unoptimized":
        return this.context.loadBatched(streamName, requireLeader, this.codec.decode, this.fold, initial, version)
      case "LatestKnownEvent":
        return this.context.loadLast(streamName, requireLeader, this.codec.decode, this.fold, initial)
      case "AdjacentSnapshots": {
        const result = await this.context.loadSnapshot(this.categoryName, streamId, requireLeader, this.codec.decode, this.access.eventName)
        if (!result) return this.context.loadBatched(streamName, requireLeader, this.codec.decode, this.fold, this.initial, 0n)
        const [pos, snapshotEvent] = result
        const initial = this.fold(this.initial, [snapshotEvent])
        const tns = await this.context.loadBatched(streamName, requireLeader, this.codec.decode, this.fold, initial, Token.version(pos))
        return { token: Token.withSnapshot(tns.token, pos.version), state: tns.state }
      }
    }
  }

  supersedes = Token.supersedes

  load(streamId: Equinox.StreamId, _maxStaleMs: number, requireLeader: boolean) {
    return this.loadAlgorithm(streamId, requireLeader, this.initial, 0n)
  }

  async reload(streamId: Equinox.StreamId, requireLeader: boolean, t: TokenAndState<State>) {
    let result: TokenAndState<State>
    // Seriously, we need a switch expression already
    switch (this.access.type) {
      case "Unoptimized":
      case "LatestKnownEvent":
        // prettier-ignore
        result = await this.loadAlgorithm(streamId, requireLeader, t.state, Token.version(t.token))
        break
      // it is usually not ecomical to reload a snapshot due to it taking two roundtrips
      case "AdjacentSnapshots":
        const streamName = Equinox.StreamName.create(this.categoryName, streamId)
        // prettier-ignore
        result = await this.context.loadBatched(streamName, requireLeader, this.codec.decode, this.fold, t.state, Token.version(t.token))
        break
    }
    return result
  }

  async sync(
    streamId: Equinox.StreamId,
    ctx: Context,
    token: StreamToken,
    state: State,
    events: Event[],
  ): Promise<SyncResult<State>> {
    const span = trace.getActiveSpan()
    const streamName = Equinox.StreamName.create(this.categoryName, streamId)
    span?.setAttributes({
      [Tags.category]: this.categoryName,
      [Tags.stream_name]: streamName,
    })
    const encode = (ev: Event) => this.codec.encode(ev, ctx)
    const encodedEvents = await Promise.all(events.map(encode))
    const newState = this.fold(state, events)
    const newVersion = token.version + BigInt(events.length)
    const onSync = this.onSync
    const runInSameTransaction =
      onSync && ((conn: Client) => onSync(conn, streamId, newState, newVersion))
    const result = await this.context.sync(streamName, token, encodedEvents, runInSameTransaction)
    switch (result.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(streamId, true, { token, state }),
        }
      case "Written": {
        switch (this.access.type) {
          case "LatestKnownEvent":
          case "Unoptimized":
            break
          case "AdjacentSnapshots": {
            const shapshotFrequency = this.access.frequency ?? this.context.batchSize
            const shouldSnapshot = Token.shouldSnapshot(shapshotFrequency, token, result.token)
            span?.setAttribute(Tags.snapshot_written, shouldSnapshot)
            if (shouldSnapshot) {
              // prettier-ignore
              await this.storeSnapshot(this.categoryName, streamId, ctx, result.token, this.access.toSnapshot(newState))
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
    caching?: ICachingStrategy,
    access?: AccessStrategy<Event, State>,
    project?: OnSync<State>,
  ) {
    const inner = new InternalCategory(context, categoryName, codec, fold, initial, access, project)
    const category = CachingCategory.apply(categoryName, inner, caching)
    const empty: TokenAndState<State> = { token: context.tokenEmpty, state: initial }
    return new Equinox.Category(category, empty)
  }
}

// uniques an array while preserving order
function uniq<T>(arr: T[]): T[] {
  const set = new Set<T>()
  const result: T[] = []
  for (const item of arr) {
    if (!set.has(item)) {
      set.add(item)
      result.push(item)
    }
  }
  return result
}
