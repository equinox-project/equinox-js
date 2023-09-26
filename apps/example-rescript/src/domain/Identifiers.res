@module("crypto") @val
external randomUUID: unit => string = "randomUUID"

module UUID = () => {
  type t
  external toString: t => string = "%identity"
  external parse: string => t = "%identity"
  external encode: t => Js.Json.t = "%identity"
  let create = () => parse(randomUUID())
}

module PayerId = UUID() 
module InvoiceId = UUID() 
