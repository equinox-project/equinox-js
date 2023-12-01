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
}
