import { StreamId } from "./StreamId"

export type StreamName = string & { __brand: "StreamName" }

// Ugly hack to get typescript to export the type and the namespace
// under the same name

export namespace StreamName {
  namespace Category {
    export const separator = "-"
    export function validate(raw: string) {
      if (raw === "") throw new Error("StreamName: Category element must not be empty")
      if (raw.includes(separator))
        throw new Error(
          `StreamName: Category element "${raw}" must not contain embedded '-' symbols`,
        )
    }
    export function ofStreamName(x: StreamName) {
      return x.slice(0, x.indexOf(separator))
    }
  }

  export function category(x: StreamName) {
    return Category.ofStreamName(x)
  }

  namespace Internal {
    export function tryParse(raw: string): [string, StreamId] | undefined {
      const idx = raw.indexOf(Category.separator)
      const category = raw.substring(0, idx)
      const id = raw.substring(idx + 1)
      if (idx < 0 || !id || !category) return undefined
      return [category, id as StreamId]
    }
  }

  export function parse(x: string) {
    const idx = x.indexOf(Category.separator)
    if (idx === -1)
      throw new Error(`StreamName "${x}" must contain a category separator "${Category.separator}"`)
    return x as StreamName
  }

  export function create(category: string, id: StreamId) {
    Category.validate(category)
    return (category + Category.separator + id) as StreamName
  }

  export function compose(category: string, elements: string[]) {
    return create(category, StreamId.Elements.compose(elements))
  }

  export function split(x: StreamName) {
    const result = Internal.tryParse(x)
    // should never happen
    if (result === undefined) throw new Error(`StreamName "${x}" is invalid`)
    return result
  }

  export function tryMatch<T>(category: string, dec: (id: StreamId) => T) {
    return (x: StreamName): T | undefined => {
      const [cat, id] = split(x)
      if (cat === category) return dec(id)
      return undefined
    }
  }

  export function tryFind(category: string) {
    return tryMatch(category, (id) => id)
  }

  type StreamIdFunc = (...args: any[]) => StreamId

  export function gen<Id extends StreamIdFunc>(
    category: string,
    streamId: Id,
  ): (...args: Parameters<Id>) => StreamName {
    return (...args: Parameters<Id>) => create(category, streamId(...args))
  }

  type Id<T> = {
    toString(v: T): string
    parse(raw: string): T
  }

  type StreamNameModule<Ids extends any[]> = {
    category: string
    streamId: (...args: Ids) => StreamId
    decodeId: (id: StreamId) => Ids
    tryMatch: (x: StreamName) => Ids | undefined
    name: (...args: Ids) => StreamName
  }

  type SingleIdStreamNameModule<A> = {
    category: string
    streamId: (id: A) => StreamId
    decodeId: (id: StreamId) => A
    tryMatch: (x: StreamName) => A | undefined
    name: (id: A) => StreamName
  }

  export function from<A>(category: string, id: Id<A>): SingleIdStreamNameModule<A>
  export function from<A, B>(category: string, id: Id<A>, id2: Id<B>): StreamNameModule<[A, B]>
  export function from<A, B, C>(
    category: string,
    id: Id<A>,
    id2: Id<B>,
    id3: Id<C>,
  ): StreamNameModule<[A, B, C]>
  export function from<A, B, C, D>(
    category: string,
    id: Id<A>,
    id2: Id<B>,
    id3: Id<C>,
    id4: Id<D>,
  ): StreamNameModule<[A, B, C, D]>
  export function from(
    category: string,
    ...ids: [Id<any>, ...Id<any>[]]
  ): StreamNameModule<any[]> | SingleIdStreamNameModule<any> {
    // @ts-ignore
    const streamId = StreamId.gen(...ids.map((id) => id.toString))
    // @ts-ignore
    const decodeId = StreamId.dec(...ids.map((id) => id.parse))
    const tryMatch_ = tryMatch(category, decodeId)
    const name = gen(category, streamId)
    return {
      category,
      streamId,
      decodeId,
      tryMatch: tryMatch_,
      name,
    }
  }
}
