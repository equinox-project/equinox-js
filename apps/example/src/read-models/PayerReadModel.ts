import { ITimelineEvent } from "@equinox-js/core"
import { Pool } from "pg"
import { PayerId } from "../domain/identifiers.js"
import { Payer } from "../domain/index.js"
import { forEntity, Change, createProjection } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; version: bigint; name: string; email: string }

const { Delete, Upsert } = forEntity<Payer, "id"| "version">()

export const projection = { table: "payer", id: ["id"], version: "version"}

function changes(stream: string, events: ITimelineEvent<string>[]): Change[] {
  const id = Payer.Stream.tryParseId(stream) 
  if (!id) return []
  const event = Payer.Events.codec.tryDecode(events[events.length - 1])
  if (!event) return []
  const version = events[events.length - 1]!.index
  switch (event.type) {
    case "PayerProfileUpdated":
      const data = event.data
      return [Upsert({ id: id, version, name: data.name, email: data.email })]
    case "PayerDeleted":
      return [Delete({ id: id, version })]
  }
}

export const ensureTable = (pool: Pool) =>
  pool.query(
    `create table if not exists payer (
      id uuid not null primary key,
      version bigint not null,
      name text not null,
      email text not null
    )`,
  )

export const createHandler = (pool: Pool) => createProjection(projection, pool, changes)
