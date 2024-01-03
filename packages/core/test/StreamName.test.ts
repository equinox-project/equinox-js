import { describe, test, expect } from "vitest"
import { StreamId, StreamName, Uuid } from "../src/index.js"

const foobar = StreamName.create("foo", StreamId.create("bar"))
const foobazbaz = StreamName.create("foo", StreamId.create("baz-baz"))


describe("StreamName", () => {
  test("create", () => {
    expect(StreamName.create("foo", StreamId.create("bar"))).toBe("foo-bar")
    expect(StreamName.create("foo", StreamId.create("baz-baz"))).toBe("foo-baz-baz")
    expect(() => StreamName.create("foo-bar", StreamId.create("baz"))).toThrow()
  })

  test("split", () => {
    expect(StreamName.split(foobar)).toEqual(["foo", "bar"])
    expect(StreamName.split(foobazbaz)).toEqual(["foo", "baz-baz"])
  })

  test("category", () => {
    expect(StreamName.category(foobar)).toBe("foo")
    expect(StreamName.category(foobazbaz)).toBe("foo")
  })

  test("tryMatch", () => {
    const SomeId = Uuid.create("SomeId")
    const id = SomeId.create()
    const streamId= StreamId.gen(SomeId.toString)
    const decodeId = StreamId.dec(SomeId.parse)
    const match = StreamName.tryMatch("foo", decodeId)
    const streamName = StreamName.create("foo", streamId(id))
    expect(match(streamName)).toEqual(id)
    expect(() => match("foo" as any)).toThrow()
  })

  test("match with multiple ids", () => {
    const SomeId = Uuid.create("SomeId")
    const OtherId = Uuid.create("OtherId")
    const streamId = StreamId.gen(SomeId.toString, OtherId.toString)
    const decodeId = StreamId.dec(SomeId.parse, OtherId.parse)
    const id1 = SomeId.create()
    const id2 = OtherId.create()
    const match = StreamName.tryMatch("foo", decodeId)
    const streamName = StreamName.create("foo", streamId(id1, id2))
    expect(match(streamName)).toEqual([id1, id2])
    expect(() => match("foo" as any)).toThrow()
  })
})
