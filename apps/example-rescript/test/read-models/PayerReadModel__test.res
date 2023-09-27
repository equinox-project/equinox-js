open Vitest
open Equinox
open Identifiers

let updated = Payer.Event.PayerProfileUpdated({name: "Test", email: "test@example.com"})
let updated2 = Payer.Event.PayerProfileUpdated({name: "Test 2", email: "test@example.com"})
let deleted = Payer.Event.PayerDeleted

let pool = Postgres.Pool.make({
  connectionString: "postgres://postgres:postgres@localhost:5432/postgres",
  max: 1,
})

beforeAll(() => PayerReadModel.ensureTable(pool))

external bigint_of_int: int => Js.Bigint.t = "BigInt"

let given = async (payerId, ~index=0, events) => {
  let handler = PayerReadModel.createHandler(pool)
  let encode = (i, ev) =>
    Payer.Event.codec.encode(ev, ())->EventData.toTimelineEvent(bigint_of_int(i + index))
  await handler(Payer.Stream.name(payerId), events->Belt.Array.mapWithIndex(encode))
  let rows =
    await pool->Postgres.Pool.query("select * from payer where id = $1", [payerId]->Obj.magic)
  rows.rows
}

describe("PayerReadModel", () => {
  testAsync("a single payer profile", async () => {
    let id = PayerId.create()
    let rows = await given(id, [updated])
    rows->Expect.toEqual([{"name": "Test", "id": id, "version": "0", "email": "test@example.com"}])
  })

  testAsync("a single payer profile updated and deleted", async () => {
    let id = PayerId.create()
    let rows = await given(id, [updated, deleted])
    rows->Expect.toEqual([])
  })

  testAsync("a single payer profile updated and deleted in different batches", async () => {
    let id = PayerId.create()
    let _ = await given(id, [updated])
    let rows = await given(id, ~index=1, [deleted])
    rows->Expect.toEqual([])
  })

  testAsync("a single payer profile updated twice", async () => {
    let id = PayerId.create()
    let rows = await given(id, [updated, updated2])
    rows->Expect.toEqual([
      {"name": "Test 2", "id": id, "version": "1", "email": "test@example.com"},
    ])
  })

  testAsync("Different payers updated", async () => {
    let id = PayerId.create()
    let id2 = PayerId.create()
    let _ = await given(id, [updated])
    let _ = await given(id2, [updated2])
    let rows =
      await pool->Postgres.Pool.query(
        "select * from payer where id = ANY($1)",
        [[id, id2]]->Obj.magic,
      )

    rows.rows->Expect.toEqual([
      {"name": "Test", "id": id, "version": "0", "email": "test@example.com"},
      {"name": "Test 2", "id": id2, "version": "0", "email": "test@example.com"},
    ])
  })
})

