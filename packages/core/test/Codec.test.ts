import { describe, test, expect } from "vitest"
import { Codec } from "../src"
import { z, ZodError } from "zod"
import { randomUUID } from "crypto"

describe("Codec", () => {
  describe("json", () => {
    test("roundtrips", () => {
      const codec = Codec.json<any>(() => ({ hello: "world" }))
      const event = { type: "Hello", data: { world: "hello" } }
      expect(codec.encode(event, null)).toEqual({
        type: "Hello",
        data: '{"world":"hello"}',
        meta: '{"hello":"world"}',
      })
      expect(
        codec.tryDecode({
          type: "Hello",
          data: '{"world":"hello"}',
          meta: '{"hello":"world"}',
        } as any),
      ).toEqual(event)
    })
  })

  describe("zod", () => {
    test("decoding", () => {
      const HelloSchema = z.object({ hello: z.string().uuid() })
      const codec = Codec.zod({ Hello: HelloSchema.parse })
      expect(codec.tryDecode({ type: "Hello", data: '{"world":"hello"}' } as any)).toEqual(
        undefined,
      )
      const correctEvent = { hello: randomUUID() }
      expect(codec.tryDecode({ type: "Hello", data: JSON.stringify(correctEvent) } as any)).toEqual(
        {
          type: "Hello",
          data: correctEvent,
        },
      )
    })

    test("encoding an invalid event throws", () => {
      const HelloSchema = z.object({ hello: z.string().uuid() })
      const codec = Codec.zod({ Hello: HelloSchema.parse })
      expect(() => codec.encode({ type: "Hello", data: { hello: "1234" } }, null)).toThrow(ZodError)
    })
    test("encoding a valid event", () => {
      const HelloSchema = z.object({ hello: z.string().uuid() })
      const codec = Codec.zod({ Hello: HelloSchema.parse })
      const event = { type: "Hello" as const, data: { hello: randomUUID() } }
      expect(codec.encode(event, null)).toEqual({
        type: "Hello",
        data: JSON.stringify(event.data),
      })
    })

    const schema = z.object({ amount: z.number() })
    type Amount = z.infer<typeof schema>
    type Event = { type: "Increment"; data: Amount } | { type: "Decrement"; data: Amount }
    const codec = Codec.zod<Event, { hello: string }>(
      {
        Increment: schema.parse,
        Decrement: schema.parse,
      },
      (ctx) => ctx,
    )
    test("Encoding with meta", () => {
      const event: Event = { type: "Increment", data: { amount: 3 } }
      const meta = { hello: "hi" }
      const expected = {
        type: "Increment",
        data: '{"amount":3}',
        meta: '{"hello":"hi"}',
      }
      expect(codec.encode(event, meta)).toEqual(expected)
      expect(codec.tryDecode(expected as any)).toEqual(event)
    })
  })
})
