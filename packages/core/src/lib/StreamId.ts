module Internal {
  /// Throws if a candidate id element includes a '_', is null, or is empty
  const validateElement = (rawElement: string) => {
    if (rawElement === "") throw new Error("Raw element must not be empty")
    if (rawElement.includes("_"))
      throw new Error("Raw element must not contain embedded '_' symbols")
  }

  // Generates a StreamId from name elements; elements are separated from each other by '_'
  export const createStreamId = (elements: string[]) => {
    elements.forEach(validateElement)
    return elements.join("_")
  }
}

export const gen =
  <A>(fa: (value: A) => string) =>
  (a: A) =>
    fa(a)
export const gen2 =
  <A, B>(fa: (value: A) => string, fb: (value: B) => string) =>
  (a: A, b: B) =>
    Internal.createStreamId([fa(a), fb(b)])
export const gen3 =
  <A, B, C>(fa: (value: A) => string, fb: (value: B) => string, fc: (value: C) => string) =>
  (a: A, b: B, c: C) =>
    Internal.createStreamId([fa(a), fb(b), fc(c)])
export const gen4 =
  <A, B, C, D>(
    fa: (value: A) => string,
    fb: (value: B) => string,
    fc: (value: C) => string,
    fd: (value: D) => string,
  ) =>
  (a: A, b: B, c: C, d: D) =>
    Internal.createStreamId([fa(a), fb(b), fc(c), fd(d)])
