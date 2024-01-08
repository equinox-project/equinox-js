import { StreamId } from "@equinox-js/core"
import { Pool } from "pg"
import { PayerId } from "../domain/identifiers.js"
import { Payer } from "../domain/index.js"
import { forEntity, Change, createHandler, MinimalClient } from "@equinox-js/projection-pg"

type Payer = { id: PayerId; name: string; email: string }

const { Delete, Upsert } = forEntity<Payer, "id">()

export const projection = { table: "payer", id: ["id"] }

type State = { name: string; email: string } | null

function changes(streamId: StreamId, state: State): Change[] {
  const id = Payer.Stream.decodeId(streamId)
  if (!id) return []
  if (!state) return [Delete({ id })]
  return [Upsert({ id, name: state.name, email: state.email })]
}

const handler = createHandler(projection)
export const project = (client: MinimalClient, streamId: StreamId, state: State) =>
  handler(client, changes(streamId, state))

export class PayerReadModel {
  constructor(private readonly pool: Pool) {}

  readAll() {
    return this.pool.query<Payer>("SELECT * FROM payer").then((x) => x.rows)
  }
}

export function create(pool: Pool) {
  return new PayerReadModel(pool)
}
