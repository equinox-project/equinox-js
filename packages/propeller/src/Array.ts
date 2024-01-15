export function keepMap<T, V>(arr: T[], fn: (t: T) => V | undefined): V[] {
  const result = new Array<V>(arr.length)
  let idx = 0
  for (let i = 0; i < arr.length; i++) {
    const v = fn(arr[i])
    if (v) result[idx++] = v
  }
  result.length = idx
  return result
}
