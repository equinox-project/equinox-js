import { randomUUID } from "crypto"

export type Uuid<T> = string & { __brand: T }

const uuidRegex = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

export function create<T extends string>(name: T) {
  return {
    name,
    parse(value: unknown) {
      if (typeof value !== "string") {
        throw new Error("Expected string")
      }
      if (!uuidRegex.test(value)) {
        throw new Error("Expected UUID")
      }
      return value.toLowerCase() as Uuid<T>
    },
    toString(value: Uuid<T>) {
      return value.toLowerCase()
    },
    toJSON(value: Uuid<T>) {
      return value.toLowerCase()
    },
    create: () => randomUUID() as Uuid<T>,
    example: () => randomUUID() as Uuid<T>,
  }
}

