import { eventToSchema } from "./Schema"

export const sumBy =
  <T>(fn: (x: T) => number) =>
  (xs: T[]) => {
    let result = 0
    for (let i = 0; i < xs.length; ++i) result += fn(xs[i])
    return result
  }

export const map =
  <T, V>(fn: (x: T) => V) =>
  (xs: T[]) => {
    const result: V[] = new Array(xs.length)
    for (let i = 0; i < xs.length; ++i) result[i] = fn(xs[i])
    return result
  }

export const tryPick =
  <T, V>(fn: (x: T) => V | undefined) =>
  (xs: T[]) => {
    for (let i = 0; i < xs.length; ++i) {
      const result = fn(xs[i])
      if (result != null) return result
    }
  }

export const containsBackAsync =
  <T>(fn: (x: T) => Promise<boolean>) =>
  async (xs: T[]) => {
    for (let i = xs.length - 1; i >= 0; --i) {
      if (await fn(xs[i])) return true
    }
    return false
  }

export const keepMap = <T, V>(xs: T[], fn: (v: T) => V | undefined) => {
  const result: V[] = []
  for (let i = 0; i < xs.length; ++i) {
    const item = fn(xs[i])
    if (item !== undefined) result.push(item)
  }
  return result
}
