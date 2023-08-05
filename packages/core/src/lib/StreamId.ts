import { Uuid } from "./Uuid.js"

export type StreamId = Uuid<"StreamId">

namespace Element {
  export const separator = "_"
  export const validate = (raw: string) => {
    if (raw === "") throw new Error("StreamId: Element must not be empty")
    if (raw.includes(separator))
      throw new Error("StreamId: Element must not contain embedded '_' symbols")
  }
}

namespace Elements {
  export const trust = (raw: string) => raw as StreamId
  export function parseExactlyOne(raw: string) {
    Element.validate(raw)
    return trust(raw)
  }

  export function split(streamId: StreamId): string[] {
    return streamId.split(Element.separator)
  }
}

export function compose(fragments: string[]) {
  fragments.forEach(Element.validate)
  return fragments.join(Element.separator) as StreamId
}

export function parseExactlyOne(id: StreamId): string {
  return Elements.parseExactlyOne(id)
}
export function parse(count: number, id: StreamId): string[] {
  const ids = Elements.split(id)
  if (ids.length !== count)
    throw new Error(`StreamId '${id}' must contain exactly ${count} elements but has ${ids.length}`)
  return ids
}

export function gen<A>(f: (value: A) => string): (a: A) => StreamId
export function gen<A, B>(
  f: (value: A) => string,
  g: (value: B) => string,
): (a: A, b: B) => StreamId
export function gen<A, B, C>(
  f: (value: A) => string,
  g: (value: B) => string,
  h: (value: C) => string,
): (a: A, b: B, c: C) => StreamId
export function gen<A, B, C, D>(
  f: (value: A) => string,
  g: (value: B) => string,
  h: (value: C) => string,
  i: (value: D) => string,
): (a: A, b: B, c: C, d: D) => StreamId
export function gen(...fs: ((value: any) => string)[]) {
  return (...values: any[]) => {
    if (values.length !== fs.length)
      throw new Error(`StreamId: Expected ${fs.length} values but got ${values.length}`)
    return compose(fs.map((f, i) => f(values[i])))
  }
}

export function dec<A>(f: (id: string) => A): (steamId: StreamId) => A | undefined
export function dec<A, B>(
  f: (id: string) => A,
  g: (id: string) => B,
): (steamId: StreamId) => [A, B] | undefined
export function dec<A, B, C>(
  f: (id: string) => A,
  g: (id: string) => B,
  h: (id: string) => C,
): (steamId: StreamId) => [A, B, C] | undefined
export function dec<A, B, C, D>(
  f: (id: string) => A,
  g: (id: string) => B,
  h: (id: string) => C,
  i: (id: string) => D,
): (steamId: StreamId) => [A, B, C, D] | undefined
export function dec(...fs: ((x: string) => unknown)[]) {
  return (streamId: StreamId) => {
    const ids = parse(fs.length, streamId)
    if (fs.length === 1) return fs[0](ids[0])
    const result = new Array(fs.length)
    for (let i = 0; i < fs.length; i++) {
      result[i] = fs[i](ids[i])
    }
    return result
  }
}
