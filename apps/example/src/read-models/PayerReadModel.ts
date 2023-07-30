import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Pool } from "pg"
import { PayerId } from "../domain/identifiers.js"
import { Payer } from "../domain//index.js"
import { Upsert, Delete, Change, createProjection } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; name: string; email: string }

export const projection = { table: "payer", id: ["id"] }

function changes(stream: string, events: ITimelineEvent<string>[]): Change<Payer>[] {
  const id = PayerId.parse(StreamName.parseId(stream))
  const event = Payer.codec.tryDecode(events[events.length - 1])
  if (!event) return []
  switch (event.type) {
    case "PayerProfileUpdated":
      const data = event.data
      return [Upsert({ id: id, name: data.name, email: data.email })]
    case "PayerDeleted":
      return [Delete<Payer>({ id: id })]
  }
}

export const ensureTable = (pool: Pool) =>
  pool.query(
    `create table if not exists payer (
      id uuid not null primary key,
      name text not null,
      email text not null
    )`,
  )

export const createHandler = (pool: Pool) => createProjection(projection, pool, changes)
