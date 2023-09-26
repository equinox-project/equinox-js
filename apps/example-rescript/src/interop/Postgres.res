module Pool = {
  type t

  type options = {
    connectionString: string,
    max: int,
  }

  @module("pg") @new
  external make: options => t = "Pool"

  @send
  external query: (t, string, array<Js.Json.t>) => Js.Promise.t<array<Js.Json.t>> = "query"

  @send external end: t => Js.Promise.t<unit> = "end"
}
