import { describe, test, expect } from "vitest"
import { Events, Fold, Decide } from "../../src/domain/payer.js"
import { createTester, expectEventsMatching, expectNoEvents } from "./scenario.js"

const { scenario } = createTester(Fold)

const updated = Events.Event.PayerProfileUpdated.example()
describe("Codec", () => {
  test("roundtrips", () => {
    for (let i = 0; i < 100; i++) {
      const event = Events.Event.example()
      const encoded = Events.codec.encode(event, null)
      const decoded = Events.codec.tryDecode(encoded as any)
      expect(decoded).toEqual(event)
    }
  })
})

const deleted = Events.Event.PayerDeleted

describe("Payer", () => {
  scenario("Updating profile")
    .given([])
    .when(Decide.updateProfile(updated.data))
    .then(expectEventsMatching([updated]))

  scenario("Updating is idempotent")
    .given([updated])
    .when(Decide.updateProfile(updated.data))
    .then(expectNoEvents)

  scenario("Updating a second time")
    .given([updated])
    .when(Decide.updateProfile({ name: "Testman", email: "test@example.com" }))
    .then(expectEventsMatching([{ type: "PayerProfileUpdated" }]))

  scenario("Deleting a payer")
    .given([updated])
    .when(Decide.deletePayer)
    .then(expectEventsMatching([deleted]))

  scenario("Deleting a payer twice")
    .given([updated, deleted])
    .when(Decide.deletePayer)
    .then(expectNoEvents)

  scenario("Deleting a payer that doesn't exist")
    .given([])
    .when(Decide.deletePayer)
    .then(expectNoEvents)

  scenario("Updating a deleted payer")
    .given([updated, deleted])
    .when(Decide.updateProfile(updated.data))
    .then(expectEventsMatching([updated]))
})
