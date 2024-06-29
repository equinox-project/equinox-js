type t

@module("@equinox-js/message-db-source") @new
external createPg: Postgres.t => t = "PgCheckpoints"

@send
external ensureTable: t => Js.Promise.t<unit> = "ensureTable"
