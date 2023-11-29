import { describe, test, expect } from "vitest"
import * as Payer from "../../src/domain/payer.js"
import { createTester, expectEventsMatching, expectNoEvents } from "./scenario.js"

const { scenario } = createTester(Payer.Fold)

const updated: Payer.Events.Event = {
  type: "PayerProfileUpdated",
  data: {
    name: "Test",
    email: "test@example.com",
  },
}

describe("Codec", () => {
  test("roundtrips", () => {
    const encoded = Payer.Events.codec.encode(updated)
    const decoded = Payer.Events.codec.decode(encoded as any)
    expect(decoded).toEqual(updated)
  })
})

const deleted: Payer.Events.Event = { type: "PayerDeleted" }

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
