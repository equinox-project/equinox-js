const CATEGORY_SEPARATOR = "-"
const ID_SEPARATOR = "_"

function parseIdPart(rawElement: string) {
  if (rawElement === "") throw new Error("StreamName: ID element must not be empty")
  if (rawElement.includes(ID_SEPARATOR))
    throw new Error("StreamName: ID element must not contain embedded '_' symbols")
  return rawElement
}

function parseCategoryPart(rawElement: string) {
  if (rawElement === "") throw new Error("StreamName: Category element must not be empty")
  if (rawElement.includes(CATEGORY_SEPARATOR))
    throw new Error("StreamName: Category element must not contain embedded '-' symbols")
  return rawElement
}

export function create(category: string, id: string) {
  return parseCategoryPart(category) + CATEGORY_SEPARATOR + id
}

function splitCategoryAndId(streamName: string) {
  const idx = streamName.indexOf(CATEGORY_SEPARATOR)
  if (idx === -1) throw new Error("StreamName: Expected category separator '" + CATEGORY_SEPARATOR + "'")
  return [streamName.slice(0, idx), streamName.slice(idx + 1)]
}

export function parseCategoryAndId(streamName: string) {
  const [category, id] = splitCategoryAndId(streamName)
  return [parseCategoryPart(category), parseIdPart(id)]
}

export function parseCategory(streamName: string) {
  const idx = streamName.indexOf(CATEGORY_SEPARATOR)
  if (idx === -1) throw new Error("StreamName: Expected category separator '" + CATEGORY_SEPARATOR + "'")
  return parseCategoryPart(streamName.slice(0, idx))
}

export function parseCategoryAndIds(streamName: string) {
  const [category, ids] = splitCategoryAndId(streamName)
  return [parseCategoryPart(category), ids.split(ID_SEPARATOR).map(parseIdPart)]
}

export function match<A>(category: string, f: (id: string) => A): (streamName: string) => A | undefined
export function match<A, B>(category: string, f: (id: string) => A, g: (id: string) => B): (streamName: string) => [A, B] | undefined
export function match<A, B, C>(category: string, f: (id: string) => A, g: (id: string) => B, h: (id: string) => C): (streamName: string) => [A, B, C] | undefined
export function match<A, B, C, D>(category: string, f: (id: string) => A, g: (id: string) => B, h: (id: string) => C, i: (id: string) => D): (streamName: string) => [A, B, C, D] | undefined
export function match(category: string, ...fs: ((x: string) => unknown)[]) {
  return (streamName: string) => {
    const [cat, ids] = parseCategoryAndIds(streamName)
    if (cat !== category) return
    if (ids.length !== fs.length) throw new Error("StreamName: Expected " + fs.length + " IDs")
      if (fs.length === 1) return fs[0](ids[0])
    const result = new Array(fs.length)
    for (let i = 0; i < fs.length; i++) {
      result[i] = fs[i](ids[i])
    }
    return result
  }
}

