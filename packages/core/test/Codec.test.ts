import { describe, test, expect } from "vitest"
import { Codec } from "../src"
import { z } from "zod"
import { keepMap } from "../src/lib/Internal"

describe("Codec", () => {
  describe("json", () => {
    test("roundtrips", () => {
      const codec = Codec.json<any>()
      const event = { type: "Hello", data: { world: "hello" } }
      expect(codec.encode(event)).toEqual({
        type: "Hello",
        data: '{"world":"hello"}',
        meta: undefined,
        id: undefined,
      })
      expect(
        codec.decode({
          type: "Hello",
          data: '{"world":"hello"}',
          meta: undefined,
          id: "123",
        } as any),
      ).toEqual(event)
    })

    test("Keeps metadata and id if they exist", () => {
      const codec = Codec.json<any>()
      const event = { id: "123", type: "Hello", data: { world: "hello" }, meta: { hello: "hi" } }
      expect(codec.encode(event)).toEqual({
        type: "Hello",
        data: '{"world":"hello"}',
        meta: '{"hello":"hi"}',
        id: "123",
      })
    })
  })

  describe("upcast", () => {
    describe("with zod", () => {
      const HelloSchema = z.object({
        hello: z
          .string()
          .datetime()
          .transform((x) => new Date(x)),
      })
      const codec = Codec.upcast(Codec.json(), Codec.Upcast.body({ Hello: HelloSchema.parse }))

      test("roundtrips", () => {
        const event = { type: "Hello", data: { hello: new Date() } }
        const encoded = codec.encode(event)
        const decoded = codec.decode(encoded as any)
        expect(decoded).toEqual(event)
      })

      test("fails if upcast fails", () => {
        const event = { type: "Hello", data: { hello: "hello" } }
        const encoded = codec.encode(event)
        expect(() => codec.decode(encoded as any)).toThrow()
      })

      test("ignores unconfigured event types", () => {
        const event = { type: "OldHello", data: JSON.stringify({ hallo: "hallo" }) }
        expect(codec.decode(event as any)).toEqual(undefined)
      })

      test("does not roundtrip complex types", () => {
        const HelloSchema = z.object({ hello: z.date() })
        const codec = Codec.upcast(Codec.json(), Codec.Upcast.body({ Hello: HelloSchema.parse }))
        const event = { type: "Hello", data: { hello: new Date() } }
        const encoded = codec.encode(event)
        // string is not a date
        expect(() => codec.decode(encoded as any)).toThrow()
      })
    })

    describe("with custom parser", () => {
      const date = (x: unknown): Date => {
        if (x instanceof Date) return x
        if (typeof x === "string") {
          const date = new Date(x)
          if (isNaN(date.getTime())) throw new Error("unable to decode date")
          return date
        }
        throw new Error("unable to decode date")
      }

      const schema =
        <T extends Record<string, any>>(mapping: { [P in keyof T]: (x: unknown) => T[P] }) =>
        (e: Record<string, any>): T => {
          return Object.fromEntries(
            Object.entries(mapping).map(([k, decode]) => {
              return [k, decode(e[k])]
            }),
          ) as T
        }

      const HelloSchema = schema({ at: date })

      const codec = Codec.upcast(Codec.json(), Codec.Upcast.body({ Hello: HelloSchema }))
      test("roundtrips", () => {
        const event = { type: "Hello", data: { at: new Date() } }
        const encoded = codec.encode(event)
        const decoded = codec.decode(encoded as any)
        expect(decoded).toEqual(event)
      })

      test("fails if upcast fails", () => {
        const event = { type: "Hello", data: { at: "hello" } }
        const encoded = codec.encode(event)
        expect(() => codec.decode(encoded as any)).toThrow()
      })
    })
  })

  describe("keep", () => {
    test("allows keeping events based on arbitrary criteria", () => {
      const codec = Codec.keep(Codec.json(), (e): e is any => e.type === "Hello")
      const events = [{ type: "Hello" }, { type: "Goodbye" }]
      const encoded = events.map((e) => codec.encode(e))
      expect(keepMap(encoded as any, codec.decode)).toEqual([{ type: "Hello" }])
    })
  })

  describe("keepTypes", () => {
    type Event = { type: "Hello" } | { type: "Goodbye" }
    test("allows keeping events based on type", () => {
      const codec = Codec.keepTypes<Event>(Codec.json(), ["Hello", "Goodbye"])
      const events = [
        { type: "Hello" },
        { type: "Goodbye" },
        { type: "OldEventTypeThatWeDoNotUseAnymore" },
      ]
      const encoded = events.map((e) => codec.encode(e as any))
      expect(keepMap(encoded as any, codec.decode)).toEqual([
        { type: "Hello" },
        { type: "Goodbye" },
      ])
    })
  })
})

describe("Mapping metadata", () => {
  test("adding meta", () => {
    const codec = Codec.json<any, void>(() => ({ meta: { hello: "hi" } }))
    const event = { id: "123", type: "Hello", data: { world: "hello" } }
    expect(codec.encode(event)).toEqual({
      type: "Hello",
      data: '{"world":"hello"}',
      meta: '{"hello":"hi"}',
      id: "123",
    })
  })

  test("Adding correlation identifiers from context", () => {
    const codec = Codec.json<any, { correlationId: string; causationId: string }>((_e, ctx) => ({
      meta: {
        $correlationId: ctx.correlationId,
        $causationId: ctx.causationId,
      },
    }))
    const event = { id: "123", type: "Hello", data: { world: "hello" } }
    expect(codec.encode(event, { correlationId: "456", causationId: "789" })).toEqual({
      type: "Hello",
      data: '{"world":"hello"}',
      meta: '{"$correlationId":"456","$causationId":"789"}',
      id: "123",
    })
  })

  test("Generating correlation identifiers", () => {
    const correlate = () => {
      const id = "123"
      return { id, meta: { $correlationId: id, $causationId: id } }
    }
    const codec = Codec.json<any, void>(correlate)
    const event = { id: "456", type: "Hello", data: { world: "hello" } }
    expect(codec.encode(event)).toEqual({
      type: "Hello",
      data: '{"world":"hello"}',
      meta: '{"$correlationId":"123","$causationId":"123"}',
      id: "123",
    })
  })
})

describe("F# interop", () => {
  test("smartDecompress handles the weird ass headerless unaligned MS format", () => {
    const helloworld = "8kjNyclXCM8vykkBAAAA//8="
    const buf = Codec.smartDecompress({ encoding: 1, body: Buffer.from(helloworld, "base64") })
    expect(buf!.toString()).toBe("Hello World")
  })
})
