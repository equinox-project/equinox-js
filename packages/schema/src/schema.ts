import { randomUUID } from "crypto"

export class SchemaError extends Error {}

type Codec<T, V> = {
  parse: (value: unknown, path?: string[]) => T
  toJSON: (value: T) => V
  example(): T
  name: string
}

type Mapping<T extends Record<string, any>, V> = {
  [K in keyof T]: Codec<T[K], V>
}

export function schema<T extends Record<string, any>, V>(mapping: Mapping<T, V>): Codec<T, V> {
  const name = `{
${Object.entries(mapping)
  .map(([key, codec]) => `  ${key}: ${codec.name}`)
  .join(",\n")}
}`
  return {
    name,
    parse(value: unknown, path?: string[]): T {
      if (typeof value !== "object" || value == null) {
        throw new SchemaError(`${path?.join(".")}: Expected object, got ${JSON.stringify(value)}`)
      }
      const val = value as any
      const result: any = {}
      for (const key in mapping) {
        result[key] = mapping[key].parse(val[key], [...(path || []), key])
      }
      return result
    },
    toJSON: (value) => {
      const result: any = {}
      for (const key in mapping) {
        result[key] = mapping[key].toJSON(value[key])
      }
      return result
    },
    example() {
      const result: any = {}
      for (const key in mapping) {
        result[key] = mapping[key].example()
      }
      return result
    },
  }
}

export const string: Codec<string, string> = {
  name: "string",
  parse(value: unknown, path = []): string {
    if (typeof value !== "string") {
      throw new SchemaError(`${path.join(".")}: Expected string, got ${JSON.stringify(value)}`)
    }
    return value
  },
  toJSON: (value) => value,
  example: () => randomUUID(),
}

export const number: Codec<number, number> = {
  name: "number",
  parse(value: unknown): number {
    const n = Number(value)
    if (!Number.isNaN(n)) return n
    throw new SchemaError("Expected number")
  },
  toJSON: (x) => x,
  example: () => Math.random(),
}

export const int: Codec<number, number> = {
  name: "int",
  parse(value: unknown): number {
    const n = number.parse(value)
    if (!Number.isInteger(n)) {
      throw new SchemaError("Expected integer")
    }
    return n
  },
  toJSON: (x) => x,
  example: () => Math.floor(Math.random() * 100),
}

export const boolean: Codec<boolean, boolean> = {
  name: "boolean",
  parse(value: unknown): boolean {
    if (typeof value !== "boolean") {
      throw new SchemaError("Expected boolean")
    }
    return value
  },
  toJSON: (x) => x,
  example: () => Math.random() > 0.5,
}

export function array<T, V>(inner: Codec<T, V>): Codec<T[], V[]> {
  return {
    name: `Array<${inner.name}>`,
    parse(value: unknown, path = []): T[] {
      if (!Array.isArray(value)) {
        throw new SchemaError("Expected array")
      }
      return value.map((x, i) => inner.parse(x, [...path, "" + i]))
    },
    toJSON: (value) => value.map(inner.toJSON),
    example: () => [inner.example()],
  }
}

export const bigint: Codec<bigint, string> = {
  name: "bigint",
  parse(value: unknown): bigint {
    if (typeof value === "bigint") return value
    if (typeof value === "number") return BigInt(value)
    if (typeof value === "string") return BigInt(value)
    throw new SchemaError("Expected bigint")
  },
  toJSON: (x) => x.toString(10),
  example: () => BigInt(Math.floor(Math.random() * 100)),
}

export function optional<T, V>(inner: Codec<T, V>): Codec<T | undefined, V | undefined> {
  return {
    name: `Option<${inner.name}>`,
    parse(value: unknown): T | undefined {
      if (value == null) return undefined
      return inner.parse(value)
    },
    toJSON: (value) => (value == null ? undefined : inner.toJSON(value)),
    example: () => (Math.random() > 0.5 ? inner.example() : undefined),
  }
}

export function oneOf<T extends string>(values: T[]): Codec<T, T> {
  const s = new Set<T>(values)
  return {
    name: `Enum<${values.join(" | ")}>`,
    parse(value: unknown): T {
      const str = string.parse(value) as T
      if (!s.has(str)) {
        throw new SchemaError(`Expected one of ${values.join(", ")}`)
      }
      return str
    },
    toJSON: (value) => value,
    example: () => values[Math.floor(Math.random() * values.length)],
  }
}

export const email: Codec<string, string> = {
  name: `email`,
  parse(value: unknown): string {
    const str = string.parse(value)
    if (!str.includes("@")) {
      throw new SchemaError(`Expected email, got ${str}`)
    }
    return str
  },
  toJSON: (value) => value,
  example: () => "test@example.com",
}

export function regex(regex: RegExp): Codec<string, string> {
  return {
    name: `String<${regex.toString()}>`,
    parse(value: unknown): string {
      const str = string.parse(value)
      if (!regex.test(str)) {
        throw new SchemaError(`Expected string matching ${regex}`)
      }
      return str
    },
    toJSON: (value) => value,
    example: () => "",
  }
}

export const date: Codec<Date, string> = {
  name: "Date",
  parse(value: unknown): Date {
    if (value instanceof Date) return value
    if (typeof value === "string") {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return date
    }
    if (typeof value === "number") {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return date
    }
    throw new SchemaError("Expected date")
  },
  toJSON: (value) => value.toISOString(),
  example: () => new Date(),
}

const uuidRegex = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
export function uuid(): Codec<string, string> {
  return {
    name: "UUID",
    parse(value: unknown) {
      const str = string.parse(value)
      if (!uuidRegex.test(str)) {
        throw new SchemaError("Expected UUID")
      }
      return str.toLowerCase() as any
    },
    toJSON: (value) => value.toLowerCase(),
    example: () => randomUUID(),
  }
}

export function set<T, V>(inner: Codec<T, V>): Codec<Set<T>, V[]> {
  return {
    name: `Set<${inner.name}>`,
    parse(value: unknown, path = []): Set<T> {
      if (!Array.isArray(value)) {
        throw new SchemaError("Expected array")
      }
      const set = new Set<T>()
      for (let i = 0; i < value.length; i++) {
        set.add(inner.parse(value[i], [...path, "" + i]))
      }
      return set
    },
    toJSON(value) {
      const result = []
      for (const item of value) {
        result.push(inner.toJSON(item))
      }
      return result
    },
    example: () => new Set([inner.example()]),
  }
}

export function map<T, V, U>(inner: Codec<T, V>, up: (v: T) => U, down: (v: U) => T): Codec<U, V> {
  return {
    name: inner.name,
    parse(value: unknown, path = []): U {
      return up(inner.parse(value, path))
    },
    toJSON: (value) => (down ? inner.toJSON(down(value)) : inner.toJSON(value as any)),
    example: () => up(inner.example()),
  }
}

type EventOfMapping<Mapping extends { [key: string]: Codec<any, any> | undefined }> = {
  [P in keyof Mapping]: Mapping[P] extends Codec<infer T, any> ? { type: P; data: T } : { type: P }
}[keyof Mapping]

type StorageOfMapping<Mapping extends { [key: string]: Codec<any, any> | undefined }> = {
  [P in keyof Mapping]: Mapping[P] extends Codec<any, infer V> ? { type: P; data: V } : { type: P }
}[keyof Mapping]

type Creators<Mapping extends { [key: string]: Codec<any, any> | undefined }> = {
  [P in keyof Mapping]: Mapping[P] extends Codec<infer T, any>
    ? ((data: T) => { type: P; data: T }) & { example: () => { type: P; data: T } }
    : { type: P }
}

export function variant<
  K extends string,
  Mapping extends {
    [P in K]: Codec<any, any> | undefined
  },
>(mapping: Mapping): Codec<EventOfMapping<Mapping>, StorageOfMapping<Mapping>> & Creators<Mapping> {
  const name = Object.entries(mapping)
    .map(([key, codec]) => `${key}${codec ? `(${(codec as any).name})` : ""}`)
    .join("\n")

  const creators: Creators<Mapping> = {} as any
  for (const key in mapping) {
    if (!mapping.hasOwnProperty(key)) continue
    if (mapping[key] === undefined) {
      ;(creators as any)[key] = { type: key }
    } else {
      ;(creators as any)[key] = Object.assign((data: any) => ({ type: key, data }), {
        example: () => ({ type: key, data: (mapping[key] as any).example() }),
      })
    }
  }

  const codec: Codec<EventOfMapping<Mapping>, StorageOfMapping<Mapping>> = {
    name,
    parse(value: unknown, path = []) {
      if (typeof value !== "object" || value == null) {
        throw new SchemaError(`${path.join(".")}: Expected object, got ${JSON.stringify(value)}`)
      }
      const val = value as any
      const type = string.parse(val.type)
      if (!(type in mapping)) return undefined as any
      const codec = mapping[type as keyof typeof mapping]
      if (!codec) {
        return { type }
      }
      return {
        type,
        data: codec.parse(val.data, [...path, "data"]),
      }
    },
    toJSON: (value) => {
      if (value == null) throw new SchemaError("Unexpected null")
      const codec = mapping[value.type as keyof typeof mapping]
      if (codec === undefined) {
        return { type: value.type }
      }
      return {
        type: value.type,
        data: codec.toJSON((value as any).data),
      } as any
    },
    example: (): any => {
      const type = Object.keys(mapping)[Math.floor(Math.random() * Object.keys(mapping).length)]
      const codec = mapping[type as keyof typeof mapping]
      if (codec === undefined) {
        return { type }
      }
      return {
        type,
        data: codec.example(),
      }
    },
  }
  return Object.assign(codec, creators)
}

export type infer<T> = T extends Codec<infer U, any> ? U : never
export type inferStorage<T> = T extends Codec<any, infer U> ? U : never
