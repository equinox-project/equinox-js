@module("vitest")
external describe: (string, unit => unit) => unit = "describe"


@module("vitest")
external beforeAll: (unit => promise<'a>) => unit = "beforeAll"

@module("vitest")
external test: (string, unit => unit) => unit = "test"

@module("vitest")
external testAsync: (string, unit => promise<unit>) => unit = "test"

module Expect = {
  type t

  @module("vitest")
  external expect: 'a => t = "expect"
  @module("vitest") @scope("expect")
  external assertations: int => unit = "assertions"
  @send
  external toBe: (t, 'a) => unit = "toBe"
  @send
  external toEqual': (t, 'a) => unit = "toEqual"

  @send external toThrowAny': t => unit = "toThrow"
  @send external toThrow': (t, string) => unit = "toThrow"

  @inline
  let toThrowAny = (f: unit => 'a) => expect(f)->toThrowAny'
  @inline
  let toThrow = (f: unit => 'a, msg) => expect(f)->toThrow'(msg)

  @inline
  let toEqual = (a, b) => expect(a)->toEqual'(b)
}

let expect = Expect.expect
