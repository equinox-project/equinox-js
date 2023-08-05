import { Uuid } from "./Uuid.js"
import * as StreamId from "./StreamId.js"

const CATEGORY_SEPARATOR = "-"

export type StreamName = Uuid<"StreamName">

namespace Category {
  export const separator = "-"
  export const validate = (raw: string) => {
    if (raw === "") throw new Error("StreamName: Category must not be empty")
    if (raw.includes(separator))
      throw new Error("StreamName: Category must not contain embedded '-' symbols")
  }

  export const ofStreamName = (streamName: StreamName) =>
    streamName.slice(0, streamName.indexOf(separator))
}

namespace Internal {
  export const trust = (raw: string) => raw as StreamName
  export const tryParse = (raw: string) => {
    const idx = raw.indexOf(CATEGORY_SEPARATOR)
    if (idx === -1) return undefined
    return [raw.slice(0, idx), raw.slice(idx + 1)] as [string, StreamId.StreamId]
  }
}

function invalidName(raw: string) {
  return new Error(`Stream Name '${raw}' must contain a '-' separator`)
}

export function parse(raw: string): StreamName {
  const idx = raw.indexOf(CATEGORY_SEPARATOR)
  if (idx === -1) throw invalidName(raw)
  return Internal.trust(raw)
}

export function create(category: string, streamId: StreamId.StreamId): StreamName {
  Category.validate(category)
  return Internal.trust(category + Category.separator + streamId)
}

export function compose(category: string, elements: string[]): StreamName {
  return create(category, StreamId.compose(elements))
}

export function category(name: StreamName): string {
  return Category.ofStreamName(name)
}

export function split(streamName: string): [string, StreamId.StreamId] {
  const split = Internal.tryParse(streamName)
  if (!split) throw invalidName(streamName)
  return split
}

export function tryFind<T>(categoryName: string, f: (s: StreamId.StreamId) => T) {
  return (streamName: string) => {
    const [category, id] = split(streamName)
    if (category === categoryName) return f(id)
  }
}
