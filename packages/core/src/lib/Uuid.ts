import { randomUUID } from "crypto"

export type Uuid<T> = string & { __brand: T }

// Custom regex: admits any hex values matching the normal dashed cluster grouping structure
// loose in that it does not attempt to reject 'impossible/undefined' based on the UUID spec
const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parse<T>(str: string): Uuid<T> {
  if (!regex.test(str)) {
    throw new Error(`Uuid: invalid format '${str}'`)
  }
  return str.toLowerCase() as Uuid<T>
}

export type UuidModule<T> = {
  create: () => Uuid<T>
  toString: (uuid: Uuid<T>) => string
  parse: (uuid: string) => Uuid<T>
}

export type Id<T> = T extends UuidModule<infer F> ? Uuid<F> : never

export function create<T>() {
  const create = () => randomUUID() as Uuid<T>
  const toString = (uuid: Uuid<T>) => uuid as string
  return {
    create,
    toString,
    parse: parse<T>,
  }
}
