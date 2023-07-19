import { randomUUID } from "crypto"

export type Uuid<T> = string & { __brand: T }

export type UuidModule<T> = {
  create: () => Uuid<T>
  toString: (uuid: Uuid<T>) => string
  parse: (uuid: string) => Uuid<T>
}

export type Id<T> = T extends UuidModule<infer F> ? Uuid<F> : never

const uuid = {
  create: <T>() => randomUUID() as Uuid<T>,
  toString: <T>(uuid: Uuid<T>) => uuid.replace(/-/g, ""),
  parse: <T>(uuid: string) => uuid as Uuid<T>,
}

export function create<T>() {
  return uuid as UuidModule<T>
}
