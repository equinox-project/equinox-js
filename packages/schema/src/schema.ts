export class SchemaError extends Error {}

type Codec<T> = {
  parse: (value: unknown, path?: string[]) => T
  toJSON: (value: T) => unknown
  name: string
}

type Mapping<T extends Record<string, any>> = {
  [K in keyof T]: Codec<T[K]>
}

export function schema<T extends Record<string, any>>(mapping: Mapping<T>): Codec<T> {
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
  }
}

export const string: Codec<string> = {
  name: "string",
  parse(value: unknown, path = []): string {
    if (typeof value !== "string") {
      throw new SchemaError(`${path.join(".")}: Expected string, got ${JSON.stringify(value)}`)
    }
    return value
  },
  toJSON: (value) => value,
}

export const number: Codec<number> = {
  name: "number",
  parse(value: unknown): number {
    const n = Number(value)
    if (!Number.isNaN(n)) return n
    throw new SchemaError("Expected number")
  },
  toJSON: (x) => x,
}

export const int: Codec<number> = {
  name: "int",
  parse(value: unknown): number {
    const n = number.parse(value)
    if (!Number.isInteger(n)) {
      throw new SchemaError("Expected integer")
    }
    return n
  },
  toJSON: (x) => x,
}

export const boolean: Codec<boolean> = {
  name: "boolean",
  parse(value: unknown): boolean {
    if (typeof value !== "boolean") {
      throw new SchemaError("Expected boolean")
    }
    return value
  },
  toJSON: (x) => x,
}

export function array<T>(inner: Codec<T>): Codec<T[]> {
  return {
    name: `Array<${inner.name}>`,
    parse(value: unknown, path = []): T[] {
      if (!Array.isArray(value)) {
        throw new SchemaError("Expected array")
      }
      return value.map((x, i) => inner.parse(x, [...path, "" + i]))
    },
    toJSON: (value) => value.map(inner.toJSON),
  }
}

export const bigint: Codec<bigint> = {
  name: "bigint",
  parse(value: unknown): bigint {
    if (typeof value === "bigint") return value
    if (typeof value === "number") return BigInt(value)
    if (typeof value === "string") return BigInt(value)
    throw new SchemaError("Expected bigint")
  },
  toJSON: (x) => x.toString(10),
}

export function optional<T>(inner: Codec<T>): Codec<T | undefined> {
  return {
    name: `Option<${inner.name}>`,
    parse(value: unknown): T | undefined {
      if (value == null) return undefined
      return inner.parse(value)
    },
    toJSON: (value) => (value == null ? undefined : inner.toJSON(value)),
  }
}

export function oneOf<T extends string>(values: T[]): Codec<T> {
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
  }
}

export function regex(regex: RegExp): Codec<string> {
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
  }
}

export const date: Codec<Date> = {
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
}

const uuidRegex = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
export function uuid(): Codec<string> {
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
  }
}

export function map<T, V>(inner: Codec<T>, up: (v: T) => V, down?: (v: V) => T): Codec<V> {
  return {
    name: inner.name,
    parse(value: unknown, path = []): V {
      return up(inner.parse(value, path))
    },
    toJSON: (value) => (down ? inner.toJSON(down(value)) : inner.toJSON(value as any)),
  }
}

type EventOfMapping<Mapping extends { [key: string]: Codec<any> | undefined }> = {
  [P in keyof Mapping]: Mapping[P] extends Codec<infer T> ? { type: P; data: T } : { type: P }
}[keyof Mapping]

type Creators<Mapping extends { [key: string]: Codec<any> | undefined }> = {
  [P in keyof Mapping]: Mapping[P] extends Codec<infer T>
    ? (data: T) => { type: P; data: T }
    : { type: P }
}

export function variant<
  K extends string,
  Mapping extends {
    [P in K]: Codec<any> | undefined
  },
>(mapping: Mapping): Codec<EventOfMapping<Mapping>> & Creators<Mapping> {
  const name = Object.entries(mapping)
    .map(([key, codec]) => `${key}${codec ? `(${(codec as any).name})` : ""}`)
    .join("\n")

  const creators: {
    [P in keyof Mapping]: Mapping[P] extends Codec<infer T>
      ? (data: T) => { type: P; data: T }
      : { type: P }
  } = {} as any
  for (const key in mapping) {
    if (!mapping.hasOwnProperty(key)) continue
    if (mapping[key] === undefined) {
      ;(creators as any)[key] = { type: key }
    } else {
      ;(creators as any)[key] = (data: any) => ({ type: key, data })
    }
  }

  const codec: Codec<EventOfMapping<Mapping>> = {
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
      }
    },
  }
  return Object.assign(codec, creators)
}

export type infer<T> = T extends Codec<infer U> ? U : never
