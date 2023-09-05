export const keepMap = <T, V>(xs: T[], fn: (v: T) => V | undefined) => {
  const result: V[] = []
  for (let i = 0; i < xs.length; ++i) {
    const item = fn(xs[i])
    if (item !== undefined) result.push(item)
  }
  return result
}
