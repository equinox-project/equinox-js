import { describe, test, expect } from "vitest"
import * as Payer from "../../src/domain/payer.js"
import { createBDD, expectEventsMatching, expectNoEvents } from "./scenario.js"

const { scenario } = createBDD(Payer.fold, Payer.initial)

const updated: Payer.Event = {
  type: "PayerProfileUpdated",
  data: {
    name: "Test",
    email: "test@example.com",
  },
}

describe("Codec", () => {
  test("roundtrips", () => {
    const encoded = Payer.codec.encode(updated, null)
    const decoded = Payer.codec.tryDecode(encoded as any)
    expect(decoded).toEqual(updated)
  })
})

const deleted: Payer.Event = { type: "PayerDeleted" }

describe("Payer", () => {
  scenario("Updating profile")
    .given([])
    .when(Payer.Decide.updateProfile(updated.data))
    .then(expectEventsMatching([updated]))

  scenario("Updating is idempotent")
    .given([updated])
    .when(Payer.Decide.updateProfile(updated.data))
    .then(expectNoEvents)

  scenario("Updating a second time")
    .given([updated])
    .when(Payer.Decide.updateProfile({ name: "Testman", email: "test@example.com" }))
    .then(expectEventsMatching([{ type: "PayerProfileUpdated" }]))

  scenario("Deleting a payer")
    .given([updated])
    .when(Payer.Decide.deletePayer)
    .then(expectEventsMatching([deleted]))

  scenario("Deleting a payer twice")
    .given([updated, deleted])
    .when(Payer.Decide.deletePayer)
    .then(expectNoEvents)

  scenario("Deleting a payer that doesn't exist")
    .given([])
    .when(Payer.Decide.deletePayer)
    .then(expectNoEvents)

  scenario("Updating a deleted payer")
    .given([updated, deleted])
    .when(Payer.Decide.updateProfile(updated.data))
    .then(expectEventsMatching([updated]))
})
