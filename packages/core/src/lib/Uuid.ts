import { randomUUID } from "crypto"

export type Uuid<T> = string & { __brand: T }

namespace Validate {
  const zero = "0".charCodeAt(0)
  const nine = "9".charCodeAt(0)
  const a = "a".charCodeAt(0)
  const f = "f".charCodeAt(0)
  const isDigit = (c: number) => zero <= c && c <= nine
  const isHexLetter = (c: number) => a <= c && c <= f
  export const isHex = (c: number) => isDigit(c) || isHexLetter(c)
}

function parse<T>(str: string): Uuid<T> {
  str = str.toLowerCase()
  if (str.length !== 36 && str.length !== 32) {
    throw new Error(`Uuid: expected 32 or 36 characters but got ${str.length}`)
  }
  let dashCount = 0
  for (let i = 0; i < str.length; ++i) {
    if (str[i] === "-") {
      ++dashCount
      continue
    }
    if (!Validate.isHex(str.charCodeAt(i))) {
      throw new Error(`Uuid: expected hex character but got '${str[i]}' at position ${i}`)
    }
  }
  if (dashCount !== 4 && dashCount !== 0) {
    throw new Error(`Uuid: expected 0 or 4 dashes but got ${dashCount}`)
  }
  return str as Uuid<T>
}

export type UuidModule<T> = {
  create: () => Uuid<T>
  toString: (uuid: Uuid<T>) => string
  parse: (uuid: string) => Uuid<T>
}

export type Id<T> = T extends UuidModule<infer F> ? Uuid<F> : never

export function create<T extends string>(brand: T) {
  const create = () => randomUUID() as Uuid<T>
  const toString = (uuid: Uuid<T>) => uuid as string
  return {
    create,
    toString,
    parse: parse<T>,
    brand: brand,
  }
}
