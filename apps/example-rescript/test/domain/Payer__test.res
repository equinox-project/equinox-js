open Vitest

module Test = Scenario.Make({
  type event = Payer.Event.t
  type state = Payer.Fold.state
  let fold = Payer.Fold.fold
  let initial = Payer.Fold.initial
})

let profile = {
  Payer.Event.name: "Test",
  email: "test@example.com",
}

describe("Codec", () => {
  test("roundtrips", () => {
    let event = Payer.Event.PayerProfileUpdated(profile)
    let encoded = Payer.Event.codec.encode(event, ())
    let decoded = Payer.Event.codec.tryDecode(encoded->Obj.magic)
    decoded->Expect.toEqual(event)
  })
})

describe("Payer", () => {
  open Test

  scenario("Updating profile")
  ->given([])
  ->when_(Payer.Decide.updateProfile(profile))
  ->then([Payer.Event.PayerProfileUpdated(profile)])

  scenario("Updating is idempotent")
  ->given([Payer.Event.PayerProfileUpdated(profile)])
  ->when_(Payer.Decide.updateProfile(profile))
  ->then([])

  scenario("Updating a second time")
  ->given([Payer.Event.PayerProfileUpdated(profile)])
  ->when_(Payer.Decide.updateProfile({...profile, name: "Testman"}))
  ->then([Payer.Event.PayerProfileUpdated({...profile, name: "Testman"})])

  scenario("Deleting a payer")
  ->given([Payer.Event.PayerProfileUpdated(profile)])
  ->when_(Payer.Decide.deletePayer)
  ->then([Payer.Event.PayerDeleted])

  scenario("Deleting a payer twice")
  ->given([Payer.Event.PayerProfileUpdated(profile), Payer.Event.PayerDeleted])
  ->when_(Payer.Decide.deletePayer)
  ->then([])

  scenario("Deleting a payer that doesn't exist")
  ->given([])
  ->when_(Payer.Decide.deletePayer)
  ->then([])

  scenario("Updating a deleted payer")
  ->given([Payer.Event.PayerProfileUpdated(profile), Payer.Event.PayerDeleted])
  ->when_(Payer.Decide.updateProfile({...profile, name: "Testman"}))
  ->then([Payer.Event.PayerProfileUpdated({...profile, name: "Testman"})])
})
