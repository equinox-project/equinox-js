export function keepMap<T, V>(xs: T[], fn: (x: T) => V | undefined): V[] {
  const result: V[] = []
  for (let i = 0; i < xs.length; i++) {
    const v = fn(xs[i])
    if (v != undefined) result.push(v)
  }
  return result
}

export function keepMapRev<T, V>(xs: T[], fn: (x: T) => V | undefined): V[] {
  const result: V[] = []
  for (let i = 0; i < xs.length; i++) {
    const v = fn(xs[i])
    if (v != undefined) result.unshift(v)
  }
  return result
}
