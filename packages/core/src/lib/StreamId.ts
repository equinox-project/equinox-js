export type StreamId = string & { __brand: "StreamId" }
export namespace StreamId {
  export const create = (x: string) => x as StreamId
  export const toString = (x: StreamId) => x as string

  namespace Element {
    export const separator = "_"
    export function validate(raw: string) {
      if (raw === "") throw new Error("Element must not be empty")
      if (raw.includes(separator)) throw new Error("Element may not contain embedded '_' symbols")
    }
  }

  export namespace Elements {
    import separator = Element.separator
    export function parseExactlyOne(raw: string) {
      Element.validate(raw)
      return raw as StreamId
    }
    export function compose(rawFragments: string[]) {
      for (let i = 0; i < rawFragments.length; i++) Element.validate(rawFragments[i])
      return rawFragments.join(separator) as StreamId
    }
    export function split(raw: StreamId) {
      return raw.split(separator)
    }
  }

  export function parseExactlyOne(x: StreamId) {
    return Elements.parseExactlyOne(x) as string
  }

  export function parse(count: number, x: StreamId) {
    const elements = Elements.split(x)
    if (elements.length !== count)
      throw new Error(`Expected ${count} elements, but got ${elements.length}`)
    return elements
  }

  export function gen<A>(fa: (value: A) => string): (a: A) => StreamId
  export function gen<A, B>(
    fa: (value: A) => string,
    fb: (value: B) => string,
  ): (a: A, b: B) => StreamId
  export function gen<A, B, C>(
    fa: (value: A) => string,
    fb: (value: B) => string,
    fc: (value: C) => string,
  ): (a: A, b: B, c: C) => StreamId
  export function gen<A, B, C, D>(
    fa: (value: A) => string,
    fb: (value: B) => string,
    fc: (value: C) => string,
    fd: (value: D) => string,
  ): (a: A, b: B, c: C, d: D) => StreamId
  export function gen(...fns: ((value: any) => string)[]) {
    if (fns.length === 1) return (a: any) => Elements.parseExactlyOne(fns[0](a))
    return (...values: any[]) => {
      const ids = new Array(fns.length)
      for (let i = 0; i < fns.length; i++) {
        const id = fns[i](values[i])
        Element.validate(id)
        ids[i] = id
      }
      return ids.join(Element.separator) as StreamId
    }
  }

  export function dec<A>(fa: (value: string) => A): (a: StreamId) => A
  export function dec<A, B>(
    fa: (value: string) => A,
    fb: (value: string) => B,
  ): (a: StreamId) => [A, B]
  export function dec<A, B, C>(
    fa: (value: string) => A,
    fb: (value: string) => B,
    fc: (value: string) => C,
  ): (a: StreamId) => [A, B, C]
  export function dec<A, B, C, D>(
    fa: (value: string) => A,
    fb: (value: string) => B,
    fc: (value: string) => C,
    fd: (value: string) => D,
  ): (a: StreamId) => [A, B, C, D]
  export function dec(...fns: ((value: string) => any)[]) {
    if (fns.length === 1) return (id: StreamId) => fns[0](Elements.parseExactlyOne(id))
    return (id: StreamId) => {
      const elements = Elements.split(id)
      if (elements.length !== fns.length)
        throw new Error(`Expected ${fns.length} elements, but got ${elements.length}`)
      const values = new Array(fns.length)
      for (let i = 0; i < fns.length; i++) values[i] = fns[i](elements[i])
      return values
    }
  }
}
