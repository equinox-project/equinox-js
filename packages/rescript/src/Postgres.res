type t

type options = {
  connectionString: string,
  max: int,
}

@module("pg") @scope("default") @new
external make: options => t = "Pool"

type query_result = {rows: array<Js.Json.t>}

@send external query: (t, string, array<Js.Json.t>) => Js.Promise.t<query_result> = "query"

@send external end: t => Js.Promise.t<unit> = "end"
