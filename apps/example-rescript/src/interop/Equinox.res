type event_data<'format> = {
  id?: string,
  @as("type")
  type_: string,
  data: option<'format>,
  meta: option<'format>,
}
type timeline_event<'format> = {
  id: string,
  time: Js.Date.t,
  @as("type")
  type_: string,
  data?: 'format,
  meta?: 'format,
  index: Js.Bigint.t,
  isUnfold: bool,
  size: int,
}

@module("crypto") @val
external randomUUID: unit => string = "randomUUID"

module EventData = {
  let toTimelineEvent = (ev: event_data<'f>, index): timeline_event<'f> => {
    let id = switch ev.id {
    | None => randomUUID()
    | Some(x) => x
    }
    let time = Js.Date.make()
    let isUnfold = false
    let size = 0
    {id, time, type_: ev.type_, data: ?ev.data, meta: ?ev.meta, index, isUnfold, size}
  }
}

module Codec = {
  type t<'e, 'f, 'c> = {
    tryDecode: timeline_event<'f> => option<'e>,
    encode: ('e, 'c) => event_data<'f>,
  }

  let json = (encode, tryDecode) => {
    let tryDecode = ev => tryDecode((ev.type_, ev.data))
    let encode = (ev, ctx): event_data<string> => {
      let (type_, data) = encode(ev, ctx)
      {type_, data, meta: None}
    }
    {tryDecode, encode}
  }
}

module Category = {
  type t<'e, 's, 'c>
}

module StreamId = {
  type t

  @module("@equinox-js/core") @scope("StreamId") @val
  external create: string => t = "create"

  @module("@equinox-js/core") @scope("StreamId") @val
  external toString: t => string = "toString"

  type gen_id<'a> = 'a => t
  type gen2_id<'a, 'b> = ('a, 'b) => t

  @module("@equinox-js/core") @scope("StreamId") @val
  external gen: ('a => string) => gen_id<'a> = "gen"
  @module("@equinox-js/core") @scope("StreamId") @val
  external gen2: ('a => string, 'b => string) => gen2_id<'a, 'b> = "gen"

  type dec_id<'a> = t => 'a
  type dec2_id<'a, 'b> = t => ('a, 'b)

  @module("@equinox-js/core") @scope("StreamId") @val
  external dec: (string => 'a) => dec_id<'a> = "dec"
  @module("@equinox-js/core") @scope("StreamId") @val
  external dec2: (string => 'a, string => 'b) => dec2_id<'a, 'b> = "dec"
}

module StreamName = {
  type t

  @module("@equinox-js/core") @scope("StreamName") @val
  external category: t => string = "category"

  @module("@equinox-js/core") @scope("StreamName") @val
  external parse: string => t = "parse"

  @module("@equinox-js/core") @scope("StreamName") @val
  external create: (string, StreamId.t) => t = "create"

  @module("@equinox-js/core") @scope("StreamName") @val
  external compose: (string, array<string>) => t = "compose"

  @module("@equinox-js/core") @scope("StreamName") @val
  external split: t => (string, StreamId.t) = "split"

  type try_match<'a> = t => option<'a>
  @module("@equinox-js/core") @scope("StreamName") @val
  external tryMatch: (string, StreamId.t => 'a) => try_match<'a> = "tryMatch"
}

module Cache = {
  type t

  @module("@equinox-js/core") @new
  external createMemory: unit => t = "MemoryCache"

  @module("@equinox-js/core") @new
  external createMemoryWithCapacity: int => t = "MemoryCache"
}

module LoadOption = {
  type t' = {requireLoad?: bool, requireLeader?: bool, maxStaleMs?: float, assumeEmpty?: bool}
  type t =
    | RequireLoad
    | RequireLeader
    | AnyCachedValue
    | MaxStale(int)
    | AssumeEmpty
  let to_eqx = x =>
    switch x {
    | RequireLoad => {requireLoad: true}
    | RequireLeader => {requireLeader: true}
    | AnyCachedValue => {maxStaleMs: 9007199254740991.}
    | MaxStale(maxStaleMs) => {maxStaleMs: float_of_int(maxStaleMs)}
    | AssumeEmpty => {assumeEmpty: true}
    }
}

module Decider = {
  type t<'e, 's>

  @module("@equinox-js/core") @scope("Decider") @val
  external forStream: (Category.t<'e, 's, unit>, StreamId.t) => t<'e, 's> = "forStream"

  @module("@equinox-js/core") @scope("Decider") @val
  external forStreamWithCtx: (Category.t<'e, 's, 'c>, StreamId.t, 'c) => t<'e, 's> = "forStream"

  @send
  external transact: (t<'e, 's>, 's => array<'e>) => Js.Promise.t<unit> = "transact"

  @send
  external query: (t<'e, 's>, 's => 'q) => Js.Promise.t<'q> = "query"

  @send
  external transactAsync: (t<'e, 's>, 's => promise<array<'e>>) => Js.Promise.t<unit> =
    "transactAsync"
}

module CachingStrategy = {
  type t
  @module("@equinox-js/core") @scope("CachingStrategy") @val
  external cached: Cache.t => t = "Cache"

  @module("@equinox-js/core") @scope("CachingStrategy") @val
  external uncached: unit => t = "NoCache"
}

module MessageDbContext = {
  type t

  type options = {
    leaderPool: Postgres.Pool.t,
    followerPool: option<Postgres.Pool.t>,
    batchSize: int,
  }

  @module("@equinox-js/message-db") @scope("MessageDbContext")
  external create: options => t = "create"
}

module MessageDbAccessStrategy = {
  type t<'e, 's>
  @module("@equinox-js/message-db") @scope("AccessStrategy") @val
  external unoptimized: unit => t<'e, 's> = "Unoptimized"

  @module("@equinox-js/message-db") @scope("AccessStrategy") @val
  external latestKnownEvent: unit => t<'e, 's> = "LatestKnownEvent"

  @module("@equinox-js/message-db") @scope("AccessStrategy") @val
  external adjacentSnapshots: (string, 's => 'e) => t<'e, 's> = "AdjacentSnapshots"
  @module("@equinox-js/message-db") @scope("AccessStrategy") @val
  external adjacentSnapshotsWithFrequency: (string, 's => 'e, int) => t<'e, 's> =
    "AdjacentSnapshots"
}

module MessageDbCategory = {
  @module("@equinox-js/message-db") @scope("MessageDbCategory") @val
  external create: (
    MessageDbContext.t,
    string,
    Codec.t<'e, string, 'c>,
    ('s, array<'e>) => 's,
    's,
    CachingStrategy.t,
    MessageDbAccessStrategy.t<'e, 's>,
  ) => Category.t<'e, 's, 'c> = "create"
}

module DynamoStore = {
  type context
}

module MemoryStore = {
  type volatile_store
  @module("@equinox-js/memory-store") @new
  external create: unit => volatile_store = "VolatileStore"

  @send
  external handleFrom: (
    volatile_store,
    Js.Bigint.t,
    (StreamName.t, array<timeline_event<string>>) => promise<unit>,
  ) => promise<unit> = "handleFrom"
}

module MemoryStoreCategory = {
  @module("@equinox-js/memory-store") @scope("MemoryStoreCategory") @val
  external create: (
    MemoryStore.volatile_store,
    string,
    Codec.t<'e, string, 'c>,
    ('s, array<'e>) => 's,
    's,
  ) => Category.t<'e, 's, 'c> = "create"
}

module Checkpoints = {
  type t

  @module("@equinox-js/message-db-source") @new
  external createPg: Postgres.Pool.t => t = "PgCheckpoints"

  @send
  external ensureTable: t => Js.Promise.t<unit> = "ensureTable"
}

module Sink = {
  type t
}

module StreamsSink = {
  type options = {
    /** The handler to call for each batch of stream messages */
    handler: (StreamName.t, array<timeline_event<string>>) => promise<unit>,
    /** The maximum number of streams that can be processing concurrently
     * Note: each stream can have at most 1 handler active */
    maxConcurrentStreams: int,
    /** The number of batches the source can read ahead the currently processing batch */
    maxReadAhead: int,
  }

  @module("@equinox-js/propeller") @scope("StreamsSink")
  external create: options => Sink.t = "create"
}

module MessageDbSource = {
  type options = {
    /** The database pool to use to read messages from the category */
    pool: Postgres.Pool.t,
    /** The categories to read from */
    categories: array<string>,
    /**
     * The maximum number of messages to read from the category at a time
     * @default 500
     */
    batchSize?: int,
    /** The name of the consumer group to use for checkpointing */
    groupName: string,
    /** The checkpointer to use for checkpointing */
    checkpoints: Checkpoints.t,
    /** The sink to pump messages into */
    sink: Sink.t,
    /** emit a metric span every statsIntervalMs */
    statsIntervalMs?: int,
    /** sleep time in ms between reads when at the end of the category */
    tailSleepIntervalMs: int,
    /** sleep time in ms between checkpoint commits */
    checkpointIntervalMs?: int,
    /** When using consumer groups: the index of the consumer. 0 <= i <= consumerGroupSize
     * each consumer in the group maintains their own checkpoint */
    consumerGroupMember?: int,
    /** The number of group consumers you have deployed */
    consumerGroupSize?: int,
  }

  type t

  @send
  external start: (t, AbortSignal.t) => Js.Promise.t<unit> = "start"

  @module("@equinox-js/message-db-source") @scope("MessageDbSource")
  external create: options => t = "create"
}
