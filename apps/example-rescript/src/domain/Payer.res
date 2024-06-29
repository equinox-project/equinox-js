open Equinox
open Identifiers

module Stream = {
  let category = "Payer"
  let streamId = StreamId.gen(PayerId.toString)
  let decodeId = StreamId.dec(PayerId.parse)
  let tryMatch = StreamName.tryMatch(category, decodeId)
  let name = id => StreamName.create(category, streamId(id))
}

module Event = {
  @decco
  type payer_profile = {
    name: string,
    email: string,
  }
  @decco
  type t = PayerProfileUpdated(payer_profile) | PayerDeleted

  let encode = (x, ()) =>
    switch x {
    | PayerProfileUpdated(data) => ("PayerProfileUpdated", Js.Json.stringifyAny(data))
    | PayerDeleted => ("PayerDeleted", None)
    }

  let tryDecode = x =>
    switch x {
    | ("PayerProfileUpdated", Some(data)) =>
      PayerProfileUpdated(Js.Json.parseExn(data)->Obj.magic)->Some
    | ("PayerDeleted", _) => Some(PayerDeleted)
    | _ => None
    }

  let codec = Codec.json(encode, tryDecode)
}

module Fold = {
  type state = option<Event.payer_profile>
  let initial = None
  let evolve = (_state, event) =>
    switch event {
    | Event.PayerProfileUpdated(data) => Some(data)
    | Event.PayerDeleted => None
    }
  let fold = (state, events) => events->Belt.Array.reduce(state, evolve)
}

module Decide = {
  let updateProfile = data => state => {
    if state == Some(data) {
      []
    } else {
      [Event.PayerProfileUpdated(data)]
    }
  }

  let deletePayer = state => {
    if state == None {
      []
    } else {
      [Event.PayerDeleted]
    }
  }
}

module Service = {
  type t = {resolve: PayerId.t => Decider.t<Event.t, Fold.state>}

  let updateProfile = (service, id, profile) => {
    let decider = service.resolve(id)
    decider->Decider.transact(Decide.updateProfile(profile))
  }

  let deletePayer = (service, id) => {
    let decider = service.resolve(id)
    decider->Decider.transact(Decide.deletePayer)
  }

  let readProfile = (service, id) => {
    let decider = service.resolve(id)
    decider->Decider.query(state => state)
  }
}

@warning("-44")
module Config = {
  let resolveCategory = ((context, cache)) =>
    context->MessageDb.Category.create(
      Stream.category,
      Event.codec,
      Fold.fold,
      Fold.initial,
      CachingStrategy.cached(cache),
      MessageDb.AccessStrategy.latestKnownEvent(),
    )

  let create = config => {
    let category = resolveCategory(config)
    let resolve = id => Decider.forStream(category, Stream.streamId(id))
    {Service.resolve: resolve}
  }
}
