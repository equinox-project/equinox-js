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
import * as Read from "./Read.js"
import { trace } from "@opentelemetry/api"
import { Format, LibSqlReader, LibSqlWriter } from "./LibSqlClient.js"
import { CachingCategory, ICachingStrategy, IReloadableCategory, Tags } from "@equinox-js/core"
import { Client, Transaction } from "@libsql/client"
import { randomUUID } from "crypto"

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

  async loadSnapshot<Event, State>(
    streamName: string,
    decode: Decode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
    isOrigin: (e: Event) => boolean,
  ): Promise<[StreamToken, State]> {
    const snapshot = await this.conn.read.readSnapshot(streamName)
    // An end-user might add snapshotting to a category after the fact, in which case there might not be a snapshot
    // in all other cases the snapshot is guaranteed to exist if there are any events in the stream
    if (snapshot == null) {
      return this.loadBatched(streamName, decode, fold, initial)
    }
    const decoded = decode(snapshot)
    // The snapshot type may have changed, in which case we should ignore it and load a fresh state
    if (!decoded || !isOrigin(decoded)) {
      return this.loadBatched(streamName, decode, fold, initial)
    }
    const version = BigInt(snapshot.index)
    const state = fold(initial, [decoded])
    const span = trace.getActiveSpan()
    span?.setAttributes({
      [Tags.loaded_count]: 1,
      [Tags.snapshot_version]: Number(version),
    })
    return [Token.create(version), state]
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
    updateSnapshot?: (trx: Transaction) => Promise<void>,
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
      updateSnapshot,
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

  static create({ client, batchSize, maxBatches }: ContextConfig) {
    const connection = LibSqlConnection.create(client)
    return new LibSqlContext(connection, batchSize, maxBatches)
  }
}

export type AccessStrategy<Event, State> =
  | { type: "Unoptimized" }
  | { type: "LatestKnownEvent" }
  | { type: "Snapshot"; isOrigin: (e: Event) => boolean; toSnapshot: (state: State) => Event }

// prettier-ignore
export namespace AccessStrategy {
  export const Unoptimized = (): AccessStrategy<any, any> => ({ type: "Unoptimized" })
  export const LatestKnownEvent = (): AccessStrategy<any, any> => ({ type: "LatestKnownEvent" })
  export const Snapshot = <E, S>(isOrigin: (e: E) => boolean, toSnapshot: (state: S) => E): AccessStrategy<E, S> => 
    ({ type: "Snapshot", isOrigin, toSnapshot })
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
      case "Snapshot":
        // prettier-ignore
        return this.context.loadSnapshot(streamName, this.codec.decode, this.fold, this.initial, this.access.isOrigin)
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

  private updateSnapshot(
    category: string,
    streamName: string,
    ctx: Context,
    newState: State,
    version: bigint,
  ) {
    if (this.access.type !== "Snapshot") return
    const toSnapshot = this.access.toSnapshot
    return async (trx: Transaction) => {
      const snapshot = this.codec.encode(toSnapshot(newState), ctx)
      const id = randomUUID()
      await trx.execute({
        sql: `
        INSERT INTO snapshots (stream_name, category, type, data, position, id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (stream_name) DO UPDATE
        SET data = excluded.data, position = excluded.position, time = CURRENT_TIMESTAMP, type = excluded.type, id = excluded.id
      `,
        args: [streamName, category, snapshot.type, snapshot.data ?? null, version, id],
      })
    }
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
    const encodedEvents = events.map(encode)
    const newState = this.fold(state, events)
    const newVersion = Token.streamVersion(token) + BigInt(events.length)
    const updateSnapshot = this.updateSnapshot(
      this.categoryName,
      streamName,
      ctx,
      newState,
      newVersion,
    )
    const result = await this.context.sync(
      this.categoryName,
      streamName,
      token,
      encodedEvents,
      updateSnapshot,
    )
    switch (result.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(streamId, true, { token, state }),
        }
      case "Written": {
        return { type: "Written", data: { token: result.token, state: newState } }
      }
    }
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
