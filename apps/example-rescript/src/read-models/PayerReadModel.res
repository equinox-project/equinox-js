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



// function changes(stream: StreamName, events: ITimelineEvent[]): Change[] {
//   const id = Payer.Stream.tryMatch(stream)
//   if (!id) return []
//   const event = Payer.Events.codec.tryDecode(events[events.length - 1])
//   if (!event) return []
//   const version = events[events.length - 1]!.index
//   switch (event.type) {
//     case "PayerProfileUpdated":
//       const data = event.data
//       return [Upsert({ id: id, version, name: data.name, email: data.email })]
//     case "PayerDeleted":
//       return [Delete({ id: id, version })]
//   }
// }
//
// export const ensureTable = (pool: Pool) =>
//   pool.query(
//     `create table if not exists payer (
//       id uuid not null primary key,
//       version bigint not null,
//       name text not null,
//       email text not null
//     )`,
//   )
//
// export const createHandler = (pool: Pool) => createProjection(projection, pool, changes)
