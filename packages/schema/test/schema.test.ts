import { describe, it, expect } from "vitest"
import s from "../src/index.js"

describe("Schema", () => {
  describe("string", () => {
    it("should parse string", () => {
      expect(s.string.parse("hello")).toEqual("hello")
    })
    it("should fail to parse non-string", () => {
      expect(() => s.string.parse(123)).toThrow()
    })
  })
  describe("number", () => {
    it("should parse number", () => {
      expect(s.number.parse(123)).toEqual(123)
    })
    it("should fail to parse non-number", () => {
      expect(() => s.number.parse("hello")).toThrow()
    })
  })
  describe("boolean", () => {
    it("should parse boolean", () => {
      expect(s.boolean.parse(true)).toEqual(true)
    })
    it("should fail to parse non-boolean", () => {
      expect(() => s.boolean.parse("hello")).toThrow()
    })
  })
  describe("date", () => {
    it("should parse date", () => {
      expect(s.date.parse("2020-01-01")).toEqual(new Date("2020-01-01"))
    })
    it("should fail to parse non-date", () => {
      expect(() => s.date.parse("hello")).toThrow()
    })
  })
  describe("optional", () => {
    it("should parse optional", () => {
      expect(s.optional(s.string).parse("hello")).toEqual("hello")
      expect(s.optional(s.string).parse(undefined)).toEqual(undefined)
    })
  })
  describe("array", () => {
    it("should parse array", () => {
      expect(s.array(s.number).parse([1, 2, 3])).toEqual([1, 2, 3])
    })
    it("should fail to parse non-array", () => {
      expect(() => s.array(s.number).parse("hello")).toThrow()
    })
  })
})

describe("Event body", () => {
  const schema = s.schema({
    name: s.string,
    age: s.int,
    isCool: s.boolean,
    birthday: s.date,
    optional: s.optional(s.string),
    array: s.array(s.number),
  })

  it("should parse valid event body", () => {
    const body = {
      name: "John",
      age: 42,
      isCool: true,
      birthday: "2020-01-01",
      optional: undefined,
      array: [1, 2, 3],
    }
    const expected = {
      name: "John",
      age: 42,
      isCool: true,
      birthday: new Date("2020-01-01"),
      optional: undefined,
      array: [1, 2, 3],
    }
    expect(schema.parse(body)).toEqual(expected)
  })

  it("should fail to parse invalid event body", () => {
    const body = {
      name: "John",
      age: 42,
      isCool: true,
      birthday: "2020-0101", // not a date
      optional: undefined,
      array: [1, 2, 3],
    }
    expect(() => schema.parse(body)).toThrow()
  })
})

describe("variant", () => {
  const CheckedIn = s.schema({ at: s.date })
  const CheckedOut = s.schema({ at: s.date })
  const Charged = s.schema({ chargeId: s.string, at: s.date, amount: s.number })
  const Event = s.variant({
    CheckedIn,
    CheckedOut,
    Charged,
    Finalized: undefined,
  })
  type Event = s.infer<typeof Event>

  it("should parse CheckedIn", () => {
    const checkedIn = Event.CheckedIn({ at: new Date() })
    expect(Event.parse(checkedIn)).toEqual(checkedIn)
  })

  it("should parse CheckedOut", () => {
    const event = Event.CheckedOut({ at: new Date() })
    expect(Event.parse(event)).toEqual(event)
  })

  it("should parse Charged", () => {
    const event: Event = { type: "Charged", data: { chargeId: "123", at: new Date(), amount: 42 } }
    expect(Event.parse(event)).toEqual(event)
  })

  it("should parse Finalized", () => {
    const event = Event.Finalized
    expect(Event.parse(event)).toEqual(event)
  })

  it("should fail to parse invalid event", () => {
    const event = { type: "CheckedIn", data: { at: "2022222" } }
    expect(() => Event.parse(event)).toThrow()
  })

  it("should silently ignore unknown event", () => {
    const event = { type: "Unknown" }
    expect(Event.parse(event)).toEqual(undefined)
  })
})
