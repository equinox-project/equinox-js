import { describe, test, expect } from "vitest"
import { Codec } from "../src"
import { z } from "zod"
import { randomUUID } from "crypto"

describe("Codec", () => {
  describe("json", () => {
    test("roundtrips", () => {
      const codec = Codec.create<any>(Codec.Decode.json(), Codec.Encode.stringify)
      const event = { type: "Hello", data: { world: "hello" } }
      expect(codec.encode(event, undefined)).toEqual({
        type: "Hello",
        data: '{"world":"hello"}',
        meta: undefined,
        id: undefined,
      })
      expect(
        codec.tryDecode({
          type: "Hello",
          data: '{"world":"hello"}',
          meta: undefined,
          id: "123",
        } as any),
      ).toEqual(event)
    })
  })

  describe("Codec.Encode.stringify", () => {
    test("ignores meta on the event", () => {
      const event = { type: "Hello", data: { world: "hello" }, meta: { hello: "hi" } }
      expect(Codec.Encode.stringify(event, null)).toMatchObject({ meta: undefined })
    })
    test("forwards the id on the event", () => {
      const event = { type: "Hello", data: { world: "hello" }, id: "123" }
      expect(Codec.Encode.stringify(event, null)).toMatchObject({ id: "123" })
    })
    test("forwards the meta on the context", () => {
      const event = { type: "Hello", data: { world: "hello" } }
      expect(Codec.Encode.stringify(event, { hello: "hi" })).toMatchObject({
        meta: '{"hello":"hi"}',
      })
    })
  })

  describe("Codec.Decode.from", () => {
    const HelloSchema = z.object({ hello: z.string().uuid() })
    const codec = Codec.create(
      Codec.Decode.from({ Hello: HelloSchema.parse }),
      Codec.Encode.stringify,
    )
    test("decoding", () => {
      expect(() => codec.tryDecode({ type: "Hello", data: '{"world":"hello"}' } as any)).toThrow()
      const correctEvent = { hello: randomUUID() }
      expect(codec.tryDecode({ type: "Hello", data: JSON.stringify(correctEvent) } as any)).toEqual(
        {
          type: "Hello",
          data: correctEvent,
        },
      )
    })
  })

  describe("Codec.Encode.from", () => {
    type Amount = { amount: number }
    type Event = { type: "Increment"; data: Amount } | { type: "Decrement"; data: Amount }
    const encode = Codec.Encode.from<Event>({
      Increment: (e) => ({ amount: String(e.amount) }),
      Decrement: (e) => ({ amount: String(e.amount) }),
    })

    test("encoding", () => {
      const event: Event = { type: "Increment", data: { amount: 3 } }
      const expected = {
        type: "Increment",
        data: '{"amount":"3"}',
      }
      expect(encode(event, null)).toEqual(expected)
    })
  })

  describe("Codec.create", () => {
    const Amount = z.object({ amount: z.string().regex(/^\d+$/).transform(Number) })
    type Amount = z.infer<typeof Amount>
    type Event = { type: "Increment"; data: Amount } | { type: "Decrement"; data: Amount }
    const encode = Codec.Encode.from<Event>({
      Increment: (e) => ({ amount: String(e.amount) }),
      Decrement: (e) => ({ amount: String(e.amount) }),
    })
    const decode = Codec.Decode.from<Event>({
      Increment: Amount.parse,
      Decrement: Amount.parse,
    })
    const codec = Codec.create(decode, encode)
    test("round trips", () => {
      const event: Event = { type: "Increment", data: { amount: 3 } }
      const encoded = codec.encode(event, null)
      expect(encoded).toEqual({
        type: "Increment",
        data: '{"amount":"3"}',
      })
      expect(codec.tryDecode(encoded as any)).toEqual(event)
    })
  })
})

describe("Codec.createEx", () => {
  type Context = { correlationId: string; causationId: string; userId: string }
  const mapMeta = (_ev: any, ctx: Context) => ({
    // matches ESDB conventions
    $correlationId: ctx.correlationId,
    $causationId: ctx.causationId,
    userId: ctx.userId,
  })

  const codec = Codec.createEx(() => ({ type: "Hello" }), Codec.Encode.stringify, mapMeta)
  test("mapping causation to get metadata", () => {
    const ctx = { correlationId: "123", causationId: "456", userId: "789" }
    const encoded = codec.encode({ type: "Hello" }, ctx)
    expect(encoded.meta).toEqual(
      JSON.stringify({
        $correlationId: "123",
        $causationId: "456",
        userId: "789",
      }),
    )
  })
})

describe("Codec.from", () => {
  const DateSchema = z.object({
    date: z
      .string()
      .datetime()
      .transform((x) => new Date(x)),
  })
  const DateStorageSchema = z.object({
    date: z.date().transform((x) => x.toISOString()),
  })
  type Event = { type: "Date"; data: { date: Date } }

  const codec = Codec.from<Event>({
    Date: [DateSchema.parse, DateStorageSchema.parse],
  })

  test("encodes properly", () => {
    const event: Event = { type: "Date", data: { date: new Date("2022-02-02T20:20:22Z") } }
    const encoded = codec.encode(event, null)
    expect(encoded).toMatchObject({
      type: "Date",
      data: '{"date":"2022-02-02T20:20:22.000Z"}',
    })
  })

  test("decodes properly", () => {
    expect(
      codec.tryDecode({
        type: "Date",
        data: '{"date":"2022-02-02T20:20:22.000Z"}',
      } as any),
    ).toMatchObject({
      type: "Date",
      data: { date: new Date("2022-02-02T20:20:22Z") },
    })
  })
})
