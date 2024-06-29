@module("crypto") @val
external randomUUID: unit => string = "randomUUID"

module UUID = () => {
  type t
  external toString: t => string = "%identity"
  external parse: string => t = "%identity"
  external encode: t => Js.Json.t = "%identity"
  let t_decode = v => {
    switch Js.Json.decodeString(v) {
    | None => Decco.error("invalid ID", v)
    | Some(s) => Ok(parse(s))
    }
  }
  let t_encode = v => Js.Json.string(toString(v))

  let create = () => parse(randomUUID())
}

module PayerId = UUID()
module InvoiceId = UUID()
