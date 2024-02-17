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
import { Format, LibSqlReader, LibSqlWriter } from "./LibSqlClient.js"
import { CachingCategory, ICachingStrategy, IReloadableCategory, Tags } from "@equinox-js/core"
import { Client } from "@libsql/client"

const keepMap = Equinox.Internal.keepMap

type GatewaySyncResult = { type: "Written"; token: StreamToken } | { type: "ConflictUnknown" }

type Decode<E> = (v: ITimelineEvent<Format>) => E | undefined

export class LibSqlConnection {
  constructor(
    public read: LibSqlReader,
    public write: LibSqlWriter,
  ) {}

  static create(client: Client) {
    return new LibSqlConnection(new LibSqlReader(client), new LibSqlWriter(client))
  }
}

type ContextConfig = {
  client: Client
  batchSize: number
  maxBatches?: number
}

export class LibSqlContext {
  constructor(
    private readonly conn: LibSqlConnection,
    public readonly batchSize: number,
    public readonly maxBatches?: number,
  ) {}

  tokenEmpty = Token.create(-1n)

  async loadBatched<Event, State>(
    streamName: string,
    decode: Decode<Event>,
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
    )) {
      batches++
      eventCount += events.length
      state = fold(state, keepMap(events, decode))
      version = lastVersion
    }
    trace.getActiveSpan()?.setAttributes({
      [Tags.loaded_count]: eventCount,
      [Tags.batches]: batches,
      [Tags.read_version]: Number(version),
    })
    return [Token.create(version), state]
  }

  async loadLast<Event, State>(
    streamName: string,
    decode: Decode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
  ): Promise<[StreamToken, State]> {
    const [version, events] = await Read.loadLastEvent(this.conn.read, streamName)
    trace.getActiveSpan()?.setAttributes({
      [Tags.loaded_count]: 1,
      [Tags.read_version]: Number(version),
    })
    return [Token.create(version), fold(initial, keepMap(events, decode))]
  }

  async reload<Event, State>(
    streamName: Equinox.StreamName,
    token: StreamToken,
    decode: Decode<Event>,
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
    )) {
      state = fold(state, keepMap(events, decode))
      streamVersion = streamVersion > version ? streamVersion : version
      batches++
      eventCount += events.length
    }
    trace.getActiveSpan()?.setAttributes({
      [Tags.loaded_count]: eventCount,
      [Tags.batches]: batches,
    })
    return [Token.create(streamVersion), state]
  }

  async sync(
    category: string,
    streamName: string,
    token: StreamToken,
    encodedEvents: IEventData<Format>[],
  ): Promise<GatewaySyncResult> {
    const span = trace.getActiveSpan()
    const streamVersion = Token.streamVersion(token)
    const appendedTypes = new Set(encodedEvents.map((x) => x.type))
    if (appendedTypes.size <= 10) {
      span?.setAttribute(Tags.append_types, Array.from(appendedTypes))
    }
    const result = await this.conn.write.writeMessages(
      category,
      streamName,
      encodedEvents,
      streamVersion,
    )

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

  async storeSnapshot(categoryName: string, streamId: Equinox.StreamId, event: IEventData<Format>) {
    const snapshotCategoryName = Snapshot.snapshotCategory(categoryName)
    const snapshotStream = Equinox.StreamName.create(categoryName, streamId)
    await this.conn.write.writeMessages(snapshotCategoryName, snapshotStream, [event], null)
    trace.getActiveSpan()?.setAttribute(Tags.snapshot_written, true)
  }

  static create({ client, batchSize, maxBatches }: ContextConfig) {
    const connection = LibSqlConnection.create(client)
    return new LibSqlContext(connection, batchSize, maxBatches)
  }
}

export type OnSync<State> = (
  conn: Client,
  streamId: Equinox.StreamId,
  state: State,
  version: bigint,
) => Promise<void>

export type AccessStrategy<Event, State> = { type: "Unoptimized" } | { type: "LatestKnownEvent" }

export namespace AccessStrategy {
  export const Unoptimized = <E, S>(): AccessStrategy<E, S> => ({ type: "Unoptimized" })
  export const LatestKnownEvent = <E, S>(): AccessStrategy<E, S> => ({ type: "LatestKnownEvent" })
}

class InternalCategory<Event, State, Context>
  implements IReloadableCategory<Event, State, Context>
{
  constructor(
    private readonly context: LibSqlContext,
    private readonly categoryName: string,
    private readonly codec: ICodec<Event, Format, Context>,
    private readonly fold: (state: State, events: Event[]) => State,
    private readonly initial: State,
    private readonly access: AccessStrategy<Event, State> = AccessStrategy.Unoptimized(),
  ) {}

  private async loadAlgorithm(streamId: Equinox.StreamId): Promise<[StreamToken, State]> {
    const streamName = Equinox.StreamName.create(this.categoryName, streamId)
    const span = trace.getActiveSpan()
    span?.setAttributes({
      [Tags.access_strategy]: this.access.type,
      [Tags.category]: this.categoryName,
      [Tags.stream_name]: streamName,
    })
    switch (this.access.type) {
      case "Unoptimized":
        return this.context.loadBatched(streamName, this.codec.decode, this.fold, this.initial)
      case "LatestKnownEvent":
        return this.context.loadLast(streamName, this.codec.decode, this.fold, this.initial)
    }
  }

  supersedes = Token.supersedes

  async load(streamId: Equinox.StreamId, _maxStaleMs: number) {
    const [token, state] = await this.loadAlgorithm(streamId)
    return { token, state }
  }

  async reload(streamId: Equinox.StreamId, _requireLeader: boolean, t: TokenAndState<State>) {
    const streamName = Equinox.StreamName.create(this.categoryName, streamId)
    const [token, state] = await this.context.reload(
      streamName,
      t.token,
      this.codec.decode,
      this.fold,
      t.state,
    )
    return { token, state }
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
    const result = await this.context.sync(this.categoryName, streamName, token, encodedEvents)
    switch (result.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(streamId, true, { token, state }),
        }
      case "Written": {
        const newState = this.fold(state, events)
        return { type: "Written", data: { token: result.token, state: newState } }
      }
    }
  }

  async storeSnapshot(
    category: string,
    streamId: Equinox.StreamId,
    ctx: Context,
    token: StreamToken,
    snapshotEvent: Event,
  ) {
    const event = this.codec.encode(snapshotEvent, ctx)
    event.meta = JSON.stringify(Snapshot.meta(token))
    await this.context.storeSnapshot(category, streamId, event)
  }
}

export class LibSqlCategory {
  static create<Event, State, Context = null>(
    context: LibSqlContext,
    categoryName: string,
    codec: ICodec<Event, Format, Context>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
    caching?: ICachingStrategy,
    access?: AccessStrategy<Event, State>,
  ) {
    const inner = new InternalCategory(context, categoryName, codec, fold, initial, access)
    const category = CachingCategory.apply(categoryName, inner, caching)
    const empty: TokenAndState<State> = { token: context.tokenEmpty, state: initial }
    return new Equinox.Category(category, empty)
  }
}
