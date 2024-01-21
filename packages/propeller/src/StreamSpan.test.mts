import { ITimelineEvent } from "@equinox-js/core"
import { StreamSpan } from "./StreamsSink.mjs"
import { describe, test, expect } from "vitest"

const canonicalTime = new Date()
const mk = (p: bigint, c: number): ITimelineEvent[] =>
  Array.from(
    { length: c },
    (_, i): ITimelineEvent => ({
      index: p + BigInt(i),
      type: (p + BigInt(i)).toString(),
      data: undefined,
      meta: undefined,
      id: "",
      isUnfold: false,
      size: 0,
      time: canonicalTime,
    }),
  )

const { merge, dropBeforeIndex } = StreamSpan

describe("StreamSpan", () => {
  test("nothing", () => {
    const r = merge(0n, [mk(0n, 0), mk(0n, 0)])
    expect(r).toEqual([])
  })

  test("synced", () => {
    const r = merge(1n, [mk(0n, 1), mk(0n, 0)])
    expect(r).toEqual([])
  })

  test("no overlap", () => {
    const r = merge(0n, [mk(0n, 1), mk(2n, 2)])
    expect(r).toEqual([mk(0n, 1), mk(2n, 2)])
  })

  test("overlap", () => {
    const r = merge(0n, [mk(0n, 1), mk(0n, 2)])
    expect(r).toEqual([mk(0n, 2)])
  })

  test("remove nulls", () => {
    const r = merge(1n, [mk(0n, 1), mk(0n, 2)])
    expect(r).toEqual([mk(1n, 1)])
  })

  test("adjacent", () => {
    const r = merge(0n, [mk(0n, 1), mk(1n, 2)])
    expect(r).toEqual([mk(0n, 3)])
  })

  test("adjacent to min", () => {
    const r = [mk(0n, 1), mk(1n, 2)].map((x) => dropBeforeIndex(2n, x))
    expect(r).toEqual([[], mk(2n, 1)])
  })

  test("adjacent to min merge", () => {
    const r = merge(2n, [mk(0n, 1), mk(1n, 2)])
    expect(r).toEqual([mk(2n, 1)])
  })

  test("adjacent to min no overlap", () => {
    const r = merge(2n, [mk(0n, 1), mk(2n, 1)])
    expect(r).toEqual([mk(2n, 1)])
  })

  test("adjacent trim", () => {
    const r = [mk(0n, 2), mk(2n, 2)].map((x) => dropBeforeIndex(1n, x))
    expect(r).toEqual([mk(1n, 1), mk(2n, 2)])
  })

  test("adjacent trim merge", () => {
    const r = merge(1n, [mk(0n, 2), mk(2n, 2)])
    expect(r).toEqual([mk(1n, 3)])
  })

  test("adjacent trim append", () => {
    const r = [mk(0n, 2), mk(2n, 2), mk(5n, 1)].map((x) => dropBeforeIndex(1n, x))
    expect(r).toEqual([mk(1n, 1), mk(2n, 2), mk(5n, 1)])
  })

  test("adjacent trim append merge", () => {
    const r = merge(1n, [mk(0n, 2), mk(2n, 2), mk(5n, 1)])
    expect(r).toEqual([mk(1n, 3), mk(5n, 1)])
  })

  test("mixed adjacent trim append", () => {
    const r = [mk(0n, 2), mk(2n, 2), mk(5n, 1)].map((span) => dropBeforeIndex(1n, span))
    expect(r).toEqual([mk(1n, 1), mk(2n, 2), mk(5n, 1)])
  })

  test("fail", () => {
    const r = merge(11614n, [[], mk(11614n, 1)])
    expect(r).toEqual([mk(11614n, 1)])
  })

  test("fail 2", () => {
    const r = merge(11613n, [mk(11614n, 1), []])
    expect(r).toEqual([mk(11614n, 1)])
  })
})
