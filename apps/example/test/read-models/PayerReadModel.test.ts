import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Pool } from "pg"
import { describe, test, expect } from "vitest"
import { PayerId } from "../../src/domain/identifiers.js"
import * as Payer from "../../src/domain/payer.js"
import * as PayerReadModel from "../../src/read-models/PayerReadModel.js"

const updated: Payer.Events.Event = {
  type: "PayerProfileUpdated",
  data: {
    name: "Test",
    email: "test@example.com",
  },
}
const updated2: Payer.Events.Event = {
  type: "PayerProfileUpdated",
  data: {
    name: "Test 2",
    email: "test@example.com",
  },
}

const deleted: Payer.Events.Event = { type: "PayerDeleted" }

describe("PayerReadModel", () => {
  scenario("empty").then([])

  scenario("a single payer profile updated")
    .given([updated])
    .then([{ name: "Test", email: "test@example.com" }])

  scenario("a single payer profile updated and deleted").given([updated, deleted]).then([])

  scenario("a single payer profile updated twice")
    .given([updated, updated2])
    .then([{ name: "Test 2", email: "test@example.com" }])

  scenario("Different payers updated")
    .given([updated])
    .given([updated2])
    .then([
      { name: "Test", email: "test@example.com" },
      { name: "Test 2", email: "test@example.com" },
    ])

  const payerId = PayerId.create()
  scenario("deleted in a different batch").given([updated], payerId).given([deleted], payerId)
})

function scenario(name: string, batches: [string, ITimelineEvent<string>[]][] = [], version = 0) {
  return {
    given: (events: Payer.Events.Event[], payerId = PayerId.create()) => {
      const streamName = StreamName.create(Payer.Stream.CATEGORY, payerId)
      return scenario(
        name,
        batches.concat([
          [
            streamName,
            events.map((event) => {
              const encoded = Payer.Events.codec.encode(event, null) as ITimelineEvent<string>
              encoded.index = BigInt(version++)
              return encoded
            }),
          ],
        ]),
        version + events.length,
      )
    },
    then(table: any[]) {
      test(name, async () => {
        const pool = new Pool({
          connectionString: "postgres://postgres:postgres@localhost:5432/postgres",
          // we start a transaction in the beforeAll hook and roll it back after each test
          max: 1,
        })
        await PayerReadModel.ensureTable(pool)
        await pool.query("begin")
        try {
          await pool.query("truncate table payer")
          const handler = PayerReadModel.createHandler(pool)
          for (const [stream, batch] of batches) {
            await handler(stream, batch)
          }
          const result = await pool.query("select * from payer")
          expect(result.rows).toEqual(table.map(expect.objectContaining))
        } finally {
          await pool.query("rollback")
          await pool.end()
        }
      })
    },
  }
}
