export const compose = (category: string, id: string) => `${category}-${id}`
const CATEGORY_SEPARATOR = "-"
const ID_SEPARATOR = "_"

export function parseCategoryAndId(streamName: string) {
  const idx = streamName.indexOf(CATEGORY_SEPARATOR)
  return [streamName.slice(0, idx), streamName.slice(idx + 1)]
}

export function parseCategory(streamName: string) {
  const idx = streamName.indexOf(CATEGORY_SEPARATOR)
  return streamName.slice(0, idx)
}

export function parseIds(streamName: string) {
  return parseId(streamName).split(ID_SEPARATOR)
}

export function parseId(streamName: string) {
  const idx = streamName.indexOf(CATEGORY_SEPARATOR)
  return streamName.slice(idx + 1)
}
