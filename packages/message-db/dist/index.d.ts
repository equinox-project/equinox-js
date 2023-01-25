import * as Equinox from '@equinox-js/core';
import { StreamEvent, TimelineEvent, StreamToken, ICache, ICategory, StateTuple, Codec } from '@equinox-js/core';
import { Pool } from 'pg';

type MdbWriteResult = {
    type: "Written";
    position: bigint;
} | {
    type: "ConflictUnknown";
};
declare class MessageDbWriter {
    private readonly pool;
    constructor(pool: Pool);
    writeMessages(streamName: string, messages: StreamEvent[], expectedVersion: bigint | null): Promise<MdbWriteResult>;
}
declare class MessageDbReader {
    private readonly pool;
    private readonly leaderPool;
    constructor(pool: Pool, leaderPool: Pool);
    private connect;
    readLastEvent(streamName: string, requiresLeader: boolean, eventType?: string): Promise<TimelineEvent>;
    readStream(streamName: string, fromPosition: bigint, batchSize: number, requiresLeader: boolean): Promise<TimelineEvent[]>;
}

type GatewaySyncResult = {
    type: "Written";
    token: StreamToken;
} | {
    type: "ConflictUnknown";
};
type TryDecode<E> = (v: TimelineEvent) => E | null | undefined;
declare class MessageDbConnection {
    read: MessageDbReader;
    write: MessageDbWriter;
    constructor(read: MessageDbReader, write: MessageDbWriter);
    static build(pool: Pool, followerPool?: Pool): MessageDbConnection;
}
declare class MessageDbContext {
    private readonly conn;
    readonly batchSize: number;
    readonly maxBatches?: number | undefined;
    constructor(conn: MessageDbConnection, batchSize: number, maxBatches?: number | undefined);
    tokenEmpty: Equinox.StreamToken;
    loadBatched<Event>(streamName: string, requireLeader: boolean, tryDecode: TryDecode<Event>): Promise<[StreamToken, Event[]]>;
    loadLast<Event>(streamName: string, requireLeader: boolean, tryDecode: TryDecode<Event>): Promise<[StreamToken, Event[]]>;
    loadSnapshot<Event>(category: string, streamId: string, requireLeader: boolean, tryDecode: TryDecode<Event>, eventType: string): Promise<[Equinox.StreamToken, Event] | null>;
    reload<Event>(streamName: string, requireLeader: boolean, token: StreamToken, tryDecode: TryDecode<Event>): Promise<[StreamToken, Event[]]>;
    trySync(category: string, streamId: string, streamName: string, token: StreamToken, encodedEvents: StreamEvent[]): Promise<GatewaySyncResult>;
    storeSnapshot(categoryName: string, streamId: string, event: StreamEvent): Promise<{
        type: "Written";
        position: bigint;
    } | {
        type: "ConflictUnknown";
    }>;
}
type AccessStrategy<Event, State> = {
    type: "Unoptimized";
} | {
    type: "LatestKnownEvent";
} | {
    type: "AdjacentSnapshots";
    eventName: string;
    toSnapshot: (state: State) => Event;
};
type CachingStrategy = {
    type: "SlidingWindow";
    cache: ICache;
    windowInMs: number;
} | {
    type: "FixedTimespan";
    cache: ICache;
    periodInMs: number;
} | {
    type: "SlidingWindowPrefixed";
    prefix: string;
    cache: ICache;
    windowInMs: number;
};
declare class MessageDbCategory<Event, State, Context = null> extends Equinox.Category<Event, State, Context> {
    constructor(resolveInner: (categoryName: string, streamId: string) => readonly [ICategory<Event, State, Context>, string], empty: StateTuple<State>);
    static build<Event, State, Context = null>(context: MessageDbContext, codec: Codec<Event, Context>, fold: (state: State, events: Event[]) => State, initial: State, caching?: CachingStrategy, access?: AccessStrategy<Event, State>): MessageDbCategory<Event, State, Context>;
}

export { CachingStrategy, MessageDbCategory, MessageDbConnection, MessageDbContext };
