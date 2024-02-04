export function sumBy<T>(arr: T[], f: (t: T) => number): number {
  return arr.reduce((acc, t) => acc + f(t), 0)
}
