export async function* bindArrayAsync<T, V>(seq: AsyncIterable<T>, f: (x: T) => Promise<V[]>): AsyncIterable<V> {
  for await (const items of seq) {
    for (const item of await f(items)) yield item
  }
}

export async function* map<T, V>(seq: AsyncIterable<T>, f: (x: T) => V): AsyncIterable<V> {
  for await (const x of seq) {
    yield f(x)
  }
}

export async function* takeWhileInclusive<T>(seq: AsyncIterable<T>, predicate: (v: T) => boolean): AsyncIterable<T> {
  for await (const item of seq) {
    yield item
    if (!predicate(item)) return
  }
}

export async function toArray<T>(seq: AsyncIterable<T>) {
  const result: T[] = []
  for await (const x of seq) result.push(x)
  return result
}
