module Context = {
  type t

  type options = {
    leaderPool: Postgres.t,
    followerPool: option<Postgres.t>,
    batchSize: int,
  }

  @module("@equinox-js/message-db") @scope("MessageDbContext")
  external create: options => t = "create"
}

module AccessStrategy = {
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

module Category = {
  @module("@equinox-js/message-db") @scope("MessageDbCategory") @val
  external create: (
    Context.t,
    string,
    Equinox__Codec.t<'e, string, 'c>,
    ('s, array<'e>) => 's,
    's,
    Equinox__CachingStrategy.t,
    AccessStrategy.t<'e, 's>,
  ) => Equinox__Category.t<'e, 's, 'c> = "create"
}
