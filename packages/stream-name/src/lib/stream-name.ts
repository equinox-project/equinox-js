type StreamName = { category: string; streamId: string }

module Internal {
  // Throws if a candidate category includes a '-', or is empty
  const validateCategory = (rawCategory: string) => {
    if (rawCategory.includes("-")) throw new Error('Category must not contain embedded "=" symbols')
  }

  /// Throws if a candidate id element includes a '_', is null, or is empty
  const validateElement = (rawElement: string) => {
    if (rawElement === "") throw new Error("Raw element must not be empty")
    if (rawElement.includes("_")) throw new Error('Raw element must not contain embedded "_" symbols')
  }
  export const ofCategoryAndStreamId = (category: string, streamId: string) => {
    validateCategory(category)
    return { category, streamId }
  }

  // Generates a StreamId from name elements; elements are separated from each other by '_'
  export const createStreamId = (elements: string[]) => {
    elements.forEach(validateElement)
    return elements.join("_")
  }
}

export const create = (category: string, streamId: string) => Internal.ofCategoryAndStreamId(category, streamId)
export const compose = (category: string, streamIds: string[]) => Internal.ofCategoryAndStreamId(category, Internal.createStreamId(streamIds))

export const tryParse = (streamName: string): StreamName | undefined => {
  const idx = streamName.indexOf("-")
  return { category: streamName.slice(0, idx), streamId: streamName.slice(idx + 1) }
}
export const toString = (x: StreamName) => `${x.category}-${x.streamId}`
export const parse = (streamName: string) => {
  if (!streamName.includes("-")) throw new Error(`StreamName ${streamName} must include a "-" separator`)
  return tryParse(streamName) as StreamName
}
