import { setTimeout } from "timers/promises"

export function keepMap<T, V>(arr: T[], map: (item: T) => V | null | undefined): V[] {
  const result = new Array<V>(arr.length)
  let idx = 0
  for (let i = 0; i < arr.length; i++) {
    const mapped = map(arr[i])
    if (mapped != null) result[idx++] = mapped
  }
  result.length = idx
  return result
}

export function keepMapRev<T, V>(arr: T[], map: (item: T) => V | null | undefined): V[] {
  const result = new Array<V>(arr.length)
  let idx = 0
  for (let i = arr.length - 1; i >= 0; i--) {
    const mapped = map(arr[i])
    if (mapped != null) result[idx++] = mapped
  }
  result.length = idx
  return result
}

export function sleep(dueTime: number, signal: AbortSignal): Promise<void> {
  return setTimeout(dueTime, undefined, { signal })
}
