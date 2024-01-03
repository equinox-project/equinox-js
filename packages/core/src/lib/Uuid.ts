import { randomUUID } from "crypto"

export type Uuid<T> = string & { __brand: T }

// Custom regex: admits any hex values matching the normal dashed cluster grouping structure
// loose in that it does not attempt to reject 'impossible/undefined' based on the UUID spec
const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function parse<T>(str: string): Uuid<T> {
  const lower = str.toLowerCase()
  if (!regex.test(lower)) {
    throw new Error(`Uuid: invalid format '${str}'`)
  }
  return lower as Uuid<T>
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
