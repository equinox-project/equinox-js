import { describe, test, expect } from "vitest"
import { Queue, AsyncQueue } from "./Queue.js"

const toArray = <T>(q: Queue<T>) => {
  const result: T[] = []
  let item: T | undefined
  while ((item = q.tryGet())) {
    result.push(item)
  }
  return result
}

const ofArray = <T>(arr: T[]) => {
  const q = new Queue<T>()
  for (const x of arr) q.add(x)
  return q
}

describe("Queue", () => {
  test("Seeking for the last item", () => {
    const q = ofArray([1, 2, 3, 4, 5])
    expect(q.tryFind((x) => x === 5)).toEqual(5)
    expect(toArray(q)).toEqual([1, 2, 3, 4])
  })

  test("Seeking for a middle item", () => {
    const q = ofArray([1, 2, 3, 4, 5])
    expect(q.tryFind((x) => x === 3)).toEqual(3)
    expect(toArray(q)).toEqual([1, 2, 4, 5])
  })

  test("Seeking for the head item", () => {
    const q = ofArray([1, 2, 3, 4, 5])
    expect(q.tryFind((x) => x === 1)).toEqual(1)
    expect(toArray(q)).toEqual([2, 3, 4, 5])
  })
  test("Seeking for a non-existent item", () => {
    const q = ofArray([1, 2, 3, 4, 5])
    expect(q.tryFind((x) => x === 0)).toEqual(undefined)
    expect(toArray(q)).toEqual([1, 2, 3, 4, 5])
  })
})

describe("AsyncQueue", () => {
  const true_ = () => true
  const ofArray = <T>(arr: T[]) => {
    const q = new AsyncQueue<T>()
    for (const x of arr) q.add(x)
    return q
  }
  const toArray = async <T>(q: AsyncQueue<T>, signal: AbortSignal) => {
    const result: T[] = []
    while (q.size) {
      result.push(await q.tryFindAsync(true_, signal))
    }
    return result
  }
  test("Waiting on an item", async () => {
    const ctrl = new AbortController()
    const q = new AsyncQueue<number>()
    const p = q.tryFindAsync(true_, ctrl.signal)
    q.add(1)
    expect(await p).toEqual(1)
  })

  test("When an item exists it is returned raw", () => {
    const ctrl = new AbortController()
    const q = new AsyncQueue<number>()
    q.add(1)
    expect(q.tryFindAsync(true_, ctrl.signal)).toEqual(1)
  })

  test("Seeking an item resolves when a matching item is enqueued", async () => {
    const ctrl = new AbortController()
    const q = new AsyncQueue<number>()
    const p = q.tryFindAsync((x) => x === 3, ctrl.signal)
    q.add(1)
    q.add(2)
    q.add(3)
    q.add(4)
    expect(await p).toEqual(3)
    expect(await toArray(q, ctrl.signal)).toEqual([1, 2, 4])
  })
})
