import { describe, test, expect } from "vitest"
import * as Uuid from "../src/lib/Uuid.js"
import * as StreamId from "../src/lib/StreamId.js"
import * as StreamName from "../src/lib/StreamName.js"

describe("StreamName", () => {
  const sid = StreamId.gen((x: string) => x)
  test("create", () => {
    expect(StreamName.create("foo", sid("bar"))).toBe("foo-bar")
    expect(StreamName.create("foo", sid("baz-baz"))).toBe("foo-baz-baz")
    expect(() => StreamName.create("foo-bar", sid("baz"))).toThrow()
  })

  test("parseCategoryAndId", () => {
    expect(StreamName.split("foo-bar")).toEqual(["foo", "bar"])
    expect(StreamName.split("foo-baz-baz")).toEqual(["foo", "baz-baz"])
    expect(() => StreamName.split("foo")).toThrow()
  })

  test("parseCategory", () => {
    expect(StreamName.category("foo-bar" as any)).toBe("foo")
    expect(StreamName.category("foo-baz-baz" as any)).toBe("foo")
  })

  test("parseCategoryAndIds", () => {
    const SomeId = Uuid.create<"SomeId">()
    const dec = StreamId.dec(SomeId.parse, SomeId.parse)
    const tryFind = StreamName.tryFind("foo", dec)

    expect(() => tryFind("foo")).toThrow()
    expect(() => tryFind("foo-bar")).toThrow()
    expect(() => tryFind("foo-baz-baz")).toThrow()
    expect(tryFind("foo-baz_baz")).toEqual(["baz", "baz"])
  })

  test("match with multiple ids", () => {
    const SomeId = Uuid.create<"SomeId">()
    const OtherId = Uuid.create<"OtherId">()
    const streamId = StreamId.gen(SomeId.toString, OtherId.toString)
    const id1 = SomeId.create()
    const id2 = OtherId.create()
    const match = StreamName.tryFind("foo", StreamId.dec(SomeId.parse, OtherId.parse))
    const streamName = StreamName.create("foo", streamId(id1, id2))
    expect(match(streamName)).toEqual([id1, id2])
    expect(() => match("foo")).toThrow()
  })
})
