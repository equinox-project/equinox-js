type t<'e, 's>

@module("@equinox-js/core") @scope("Decider") @val
external forStream: (Equinox__Category.t<'e, 's, unit>, Equinox__StreamId.t) => t<'e, 's> =
  "forStream"

@module("@equinox-js/core") @scope("Decider") @val
external forStreamWithCtx: (Equinox__Category.t<'e, 's, 'c>, Equinox__StreamId.t, 'c) => t<'e, 's> =
  "forStream"

@send
external transact: (t<'e, 's>, 's => array<'e>) => Js.Promise.t<unit> = "transact"

@send
external query: (t<'e, 's>, 's => 'q) => Js.Promise.t<'q> = "query"

@send
external transactAsync: (t<'e, 's>, 's => promise<array<'e>>) => Js.Promise.t<unit> =
  "transactAsync"
