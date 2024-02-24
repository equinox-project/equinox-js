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

type LibSqlSyncResult = { type: "Written"; token: StreamToken } | { type: "ConflictUnknown" }

type Decode<E> = (v: ITimelineEvent<Format>) => E | undefined

export class LibSqlConnection {
  constructor(
    public read: LibSqlReader,
    public write: LibSqlWriter,
  ) {}

  static create(writeClient: Client, readClient = writeClient) {
    return new LibSqlConnection(new LibSqlReader(readClient), new LibSqlWriter(writeClient))
  }
}

type ContextConfig = {
  client: Client
  readClient?: Client
  batchSize: number
  maxBatches?: number
}

export class LibSqlContext {
  constructor(
    private readonly conn: LibSqlConnection,
    public readonly batchSize: number,
    public readonly maxBatches?: number,
  ) {}

  tokenEmpty = Token.create(0n)

  async loadBatched<Event, State>(
    streamName: string,
    decode: Decode<Event>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
  ): Promise<[StreamToken, State]> {
    let state = initial
    let version = 0n
    for await (const [lastVersion, events] of Read.loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName,
      0n,
    )) {
      state = fold(state, keepMap(events, decode))
      version = lastVersion
    }

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
    if (snapshot == null) return this.loadBatched(streamName, decode, fold, initial)
    const [etag, event] = snapshot
    const decoded = decode(event)
    // The snapshot type may have changed, in which case we should ignore it and load a fresh state
    if (!decoded || !isOrigin(decoded)) return this.loadBatched(streamName, decode, fold, initial)
    const version = event.index
    const state = fold(initial, [decoded])
    const span = trace.getActiveSpan()
    span?.setAttributes({
      [Tags.loaded_count]: 1,
      [Tags.snapshot_version]: Number(version),
    })
    return [Token.create(version, etag), state]
  }

  async reload<Event, State>(
    streamName: Equinox.StreamName,
    token: StreamToken,
    decode: Decode<Event>,
    fold: (state: State, events: Event[]) => State,
    state: State,
  ): Promise<[StreamToken, State]> {
    let streamVersion = Token.version(token)
    for await (const [version, events] of Read.loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName,
      streamVersion,
    )) {
      state = fold(state, keepMap(events, decode))
      streamVersion = version
    }
    return [Token.create(streamVersion), state]
  }

  async syncRollingState(
    category: string,
    streamName: string,
    token: StreamToken,
    encodedEvent: IEventData<Format>,
  ): Promise<LibSqlSyncResult> {
    const span = trace.getActiveSpan()
    const etag = Token.snapshotEtag(token)
    const version = Token.version(token)
    const result = await this.conn.write.writeSnapshot(
      category,
      streamName,
      encodedEvent,
      version,
      etag,
    )
    switch (result.type) {
      case "ConflictUnknown":
        span?.addEvent("Conflict")
        return { type: "ConflictUnknown" }
      case "Written": {
        const token = Token.create(result.version, result.snapshot_etag)
        return { type: "Written", token }
      }
    }
  }

  async sync(
    category: string,
    streamName: string,
    token: StreamToken,
    encodedEvents: IEventData<Format>[],
    updateSnapshot?: (trx: Transaction) => Promise<void>,
  ): Promise<LibSqlSyncResult> {
    const span = trace.getActiveSpan()
    const streamVersion = Token.version(token)
    const appendedTypes = encodedEvents.map((x) => x.type)
    span?.setAttribute(
      Tags.append_types,
      appendedTypes.length <= 10 ? appendedTypes : uniq(appendedTypes),
    )
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
        const token = Token.create(result.version)
        return { type: "Written", token }
      }
    }
  }

  static create({ client, readClient, batchSize, maxBatches }: ContextConfig) {
    const connection = LibSqlConnection.create(client, readClient)
    return new LibSqlContext(connection, batchSize, maxBatches)
  }
}

export type AccessStrategy<Event, State> =
  | { type: "Unoptimized" }
  | { type: "LatestKnownEvent" }
  | { type: "Snapshot"; isOrigin: (e: Event) => boolean; toSnapshot: (state: State) => Event }
  | { type: "RollingState"; toSnapshot: (state: State) => Event }

// prettier-ignore
export namespace AccessStrategy {
  export const Unoptimized = <E=any, S=any>(): AccessStrategy<E, S> => ({ type: "Unoptimized" })
  export const LatestKnownEvent = <E=any, S=any>(): AccessStrategy<E, S> => ({ type: "LatestKnownEvent" })
  export const Snapshot = <E, S>(isOrigin: (e: E) => boolean, toSnapshot: (state: S) => E): AccessStrategy<E, S> => 
    ({ type: "Snapshot", isOrigin, toSnapshot })
  export const RollingState = <E, S>(toSnapshot: (state: S) => E): AccessStrategy<E, S> => ({ type: "RollingState", toSnapshot })
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

  supersedes = Token.supersedes

  // prettier-ignore
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
        return this.context.loadSnapshot(streamName, this.codec.decode, this.fold, this.initial, this.access.isOrigin)
      case "RollingState":
        return this.context.loadSnapshot(streamName, this.codec.decode, this.fold, this.initial, () => true)
    }
  }

  async load(streamId: Equinox.StreamId, _maxStaleMs: number) {
    const [token, state] = await this.loadAlgorithm(streamId)
    return { token, state }
  }

  async reload(streamId: Equinox.StreamId, _requireLeader: boolean, t: TokenAndState<State>) {
    if (this.access.type === "RollingState") {
      return this.load(streamId, 0)
    }
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
    state: State,
    version: bigint,
  ) {
    if (this.access.type !== "Snapshot") return
    const toSnapshot = this.access.toSnapshot
    return async (trx: Transaction) => {
      const snapshot = this.codec.encode(toSnapshot(state), ctx)
      const id = randomUUID()
      const etag = randomUUID()
      await trx.execute({
        sql: `
        INSERT INTO snapshots (stream_name, category, type, data, version, etag, id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (stream_name) DO UPDATE
        SET data = excluded.data, version = excluded.version, time = CURRENT_TIMESTAMP, type = excluded.type, id = excluded.id, etag = excluded.etag
      `,
        args: [streamName, category, snapshot.type, snapshot.data ?? null, version, etag, id],
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
    if (this.access.type === "RollingState") {
      // Note, this is here for the compiler. `transactAsync` in core will short circuit and not call us for 0 events
      if (events.length === 0) throw new Error("Cannot sync with no events")
      const nextState = this.fold(state, events)
      const event = this.access.toSnapshot(nextState)
      const encodedEvent = this.codec.encode(event, ctx)
      const result = await this.context.syncRollingState(
        this.categoryName,
        streamName,
        token,
        encodedEvent,
      )
      switch (result.type) {
        case "ConflictUnknown":
          return {
            type: "Conflict",
            resync: () => this.reload(streamId, true, { token, state }),
          }
        case "Written": {
          return {
            type: "Written",
            data: { token: result.token, state: nextState },
          }
        }
      }
    }
    const encode = (ev: Event) => this.codec.encode(ev, ctx)
    const encodedEvents = events.map(encode)
    const newState = this.fold(state, events)
    const newVersion = Token.version(token) + BigInt(events.length)
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
  static create<Event, State, Context = void>(
    context: LibSqlContext,
    categoryName: string,
    codec: ICodec<Event, Format, Context>,
    fold: (state: State, events: Event[]) => State,
    initial: State,
    caching?: ICachingStrategy,
    access?: AccessStrategy<Event, State>,
  ): Equinox.Category<Event, State, Context> {
    const inner = new InternalCategory(context, categoryName, codec, fold, initial, access)
    const category = CachingCategory.apply(categoryName, inner, caching)
    const empty: TokenAndState<State> = { token: context.tokenEmpty, state: initial }
    return new Equinox.Category<Event, State, Context>(category, empty)
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
