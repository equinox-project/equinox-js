import { describe, test, expect } from "vitest"
import { StreamId, Uuid } from "../dist/index.js"
import * as StreamName from "../src/lib/StreamName.js"

describe("StreamName", () => {
  test("create", () => {
    expect(StreamName.create("foo", "bar")).toBe("foo-bar")
    expect(StreamName.create("foo", "baz-baz")).toBe("foo-baz-baz")
    expect(() => StreamName.create("foo-bar", "baz")).toThrow()
  })

  test("parseCategoryAndId", () => {
    expect(StreamName.parseCategoryAndId("foo-bar")).toEqual(["foo", "bar"])
    expect(StreamName.parseCategoryAndId("foo-baz-baz")).toEqual(["foo", "baz-baz"])
    expect(() => StreamName.parseCategoryAndId("foo")).toThrow()
  })

  test("parseCategory", () => {
    expect(StreamName.parseCategory("foo-bar")).toBe("foo")
    expect(StreamName.parseCategory("foo-baz-baz")).toBe("foo")
    expect(() => StreamName.parseCategory("foo")).toThrow()
  })

  test("parseCategoryAndIds", () => {
    expect(StreamName.parseCategoryAndIds("foo-bar")).toEqual(["foo", ["bar"]])
    expect(StreamName.parseCategoryAndIds("foo-baz-baz")).toEqual(["foo", ["baz-baz"]])
    expect(StreamName.parseCategoryAndIds("foo-baz_baz")).toEqual(["foo", ["baz", "baz"]])
    expect(() => StreamName.parseCategoryAndIds("foo")).toThrow()
  })

  test("match", () => {
    const SomeId = Uuid.create<"SomeId">()
    const id = SomeId.create()
    const match = StreamName.match("foo", SomeId.parse)
    const streamName = StreamName.create("foo", id)
    expect(match(streamName)).toEqual(id)
    expect(() => match("foo")).toThrow()
  })

  test("match with multiple ids", () => {
    const SomeId = Uuid.create<"SomeId">()
    const OtherId = Uuid.create<"OtherId">()
    const streamId = StreamId.gen2(SomeId.toString, OtherId.toString)
    const id1 = SomeId.create()
    const id2 = OtherId.create()
    const match = StreamName.match("foo", SomeId.parse, OtherId.parse)
    const streamName = StreamName.create("foo", streamId(id1, id2))
    expect(match(streamName)).toEqual([id1, id2])
    expect(() => match("foo")).toThrow()
  })
})
