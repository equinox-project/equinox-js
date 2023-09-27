type required = {id: Identifiers.PayerId.t, version: string}
type fields = {name: string, email: string}

type projection = {table: string, id: array<string>, version?: string}

let projection = {table: "payer", id: ["id"], version: "version"}

type change =
  | Upsert({id: required, fields: fields})
  | Delete(required)

let decodeLastEvent = (streamName, events) =>
  switch Payer.Stream.tryMatch(streamName) {
  | Some(id) =>
    switch Payer.Event.codec.tryDecode(events[events->Js.Array.length - 1]) {
    | Some(event) =>
      let version = events[events->Js.Array.length - 1].index->Js.String.make
      Some({id, version}, event)
    | _ => None
    }
  | _ => None
  }
let changes = (streamName, events) =>
  switch decodeLastEvent(streamName, events) {
  | Some(id, Payer.Event.PayerProfileUpdated(payer)) => [
      Upsert({id, fields: {name: payer.name, email: payer.email}}),
    ]
  | Some(id, Payer.Event.PayerDeleted) => [Delete(id)]
  | None => []
  }

@scope("Object") @val
external assign: ('a, 'b) => 'c = "assign"

let toEqx = x =>
  switch x {
  | Upsert({id, fields}) => {"type": 3, "data": assign(id, fields)}
  | Delete(id) => {"type": 2, "data": id}
  }

type handler = (Equinox.StreamName.t, array<Equinox.timeline_event<string>>) => promise<unit>
@module("@equinox-js/projection-pg")
external createPgProjection: (
  . projection,
  Postgres.Pool.t,
  (Equinox.StreamName.t, array<Equinox.timeline_event<string>>) => array<'a>,
) => handler = "createProjection"

let eqxHandler = (stream, events) => changes(stream, events)->Belt.Array.map(toEqx)

let createHandler = pool => createPgProjection(. projection, pool, eqxHandler)

let ensureTable = pool =>
  pool->Postgres.Pool.query(
    `create table if not exists payer (
       id uuid not null primary key,
       version bigint not null,
       name text not null,
       email text not null
     )`,
    [],
  )
