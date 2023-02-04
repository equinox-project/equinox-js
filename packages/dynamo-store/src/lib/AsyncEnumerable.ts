export async function* map<T, V>(seq: AsyncIterable<T>, f: (x: T) => V): AsyncIterable<V> {
  for await (const x of seq) {
    yield f(x)
  }
}
