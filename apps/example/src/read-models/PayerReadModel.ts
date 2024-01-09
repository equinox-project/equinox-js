import { StreamId } from "@equinox-js/core"
import { Pool } from "pg"
import { PayerId } from "../domain/identifiers.js"
import { Payer } from "../domain/index.js"
import { forEntity, Change, createHandler, MinimalClient } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; name: string; email: string; version: string }

const { Delete, Upsert } = forEntity<Payer, "id" | "version">()

export const projection = { table: "payer", id: ["id"], version: "version" }

type State = { name: string; email: string } | null

function changes(streamId: StreamId, state: State, version: string): Change[] {
  const id = Payer.Stream.decodeId(streamId)
  if (!id) return []
  if (!state) return [Delete({ id, version })]
  return [Upsert({ id, version, name: state.name, email: state.email })]
}

const handler = createHandler(projection)
export const project = (client: MinimalClient, streamId: StreamId, state: State, version: bigint) =>
  handler(client, changes(streamId, state, version.toString()))

export class PayerReadModel {
  constructor(private readonly pool: Pool) {}

  readAll() {
    return this.pool.query<Payer>("SELECT * FROM payer").then((x) => x.rows)
  }
}

export function create(pool: Pool) {
  return new PayerReadModel(pool)
}
