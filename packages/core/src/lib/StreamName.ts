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
  return [streamName.slice(0, idx), streamName.slice(idx + 1)]
}

export function parseCategoryAndId(streamName: string) {
  const [category, id] = splitCategoryAndId(streamName)
  return [parseCategoryPart(category), parseIdPart(id)]
}

export function parseCategory(streamName: string) {
  const idx = streamName.indexOf(CATEGORY_SEPARATOR)
  return parseCategoryPart(streamName.slice(0, idx))
}

export function parseCategoryAndIds(streamName: string) {
  const [category, ids] = splitCategoryAndId(streamName)
  return [parseCategoryPart(category), ids.split(ID_SEPARATOR).map(parseIdPart)]
}

export function dec<A>(category: string, f: (id: string) => A) {
  return (streamName: string) => {
    const [cat, id] = parseCategoryAndId(streamName)
    if (cat !== category) return
    return f(id)
  }
}

export function dec2<A, B>(category: string, f: (id: string) => A, g: (id: string) => B) {
  return (streamName: string) => {
    const [cat, ids] = parseCategoryAndIds(streamName)
    if (cat !== category) return
    if (ids.length !== 2) throw new Error("StreamName: Expected 2 IDs")
    return [f(ids[0]), g(ids[1])]
  }
}

export function dec3<A, B, C>(
  category: string,
  f: (id: string) => A,
  g: (id: string) => B,
  h: (id: string) => C,
) {
  return (streamName: string) => {
    const [cat, ids] = parseCategoryAndIds(streamName)
    if (cat !== category) return
    if (ids.length !== 3) throw new Error("StreamName: Expected 3 IDs") 
    return [f(ids[0]), g(ids[1]), h(ids[2])]
  }
}

export function dec4<A, B, C, D>(
  category: string,
  f: (id: string) => A,
  g: (id: string) => B,
  h: (id: string) => C,
  i: (id: string) => D,
) {
  return (streamName: string) => {
    const [cat, ids] = parseCategoryAndIds(streamName)
    if (cat !== category) return
    if (ids.length !== 4) throw new Error("StreamName: Expected 4 IDs") 
    return [f(ids[0]), g(ids[1]), h(ids[2]), i(ids[3])]
  }
}

