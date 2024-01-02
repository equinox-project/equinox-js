import { randomUUID } from "crypto"

export type Uuid<T> = string & { __brand: T }

const zero = "0".charCodeAt(0)
const nine = "9".charCodeAt(0)

const isDigit = (c: number) => zero <= c && c <= nine
const isHex = (c: number) => isDigit(c) || (97 <= c && c <= 102)

function parse<T>(str: string): Uuid<T> {
  str = str.toLowerCase()
  if (str.length !== 36 && str.length !== 32) {
    throw new Error("Invalid UUID")
  }
  let dashCount = 0
  for (let i = 0; i < str.length; ++i) {
    if (str[i] === "-") {
      ++dashCount
      continue
    }
    if (!isHex(str.charCodeAt(i))) {
      throw new Error("Invalid UUID")
    }
  }
  if (dashCount !== 4 && dashCount !== 0) {
    throw new Error("Invalid UUID")
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
