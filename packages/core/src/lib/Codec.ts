import { StreamEvent, TimelineEvent } from "./Types.js"
import * as zlib from "node:zlib"
import { promisify } from "node:util"

const deflate = promisify(zlib.deflateRaw)
const inflate = promisify(zlib.inflateRaw)

export abstract class Codec<E, F, C = undefined> {
  abstract tryDecode(event: TimelineEvent<F>): Promise<E | undefined> | E | undefined

  abstract encode(event: E, ctx: C): Promise<StreamEvent<F>> | StreamEvent<F>

  static map<E, From, C, To>(
    codec: Codec<E, From, C>,
    encode: (v: From) => To | Promise<To>,
    decode: (v: To) => From | Promise<From>
  ): Codec<E, To, C> {
    return {
      async tryDecode(event: TimelineEvent<To>): Promise<E | undefined> {
        const data = event.data ? decode(event.data) : undefined
        const meta = event.meta ? decode(event.meta) : undefined
        const from: TimelineEvent<From> = { ...event, data: await data, meta: await meta }
        return codec.tryDecode(from)
      },
      async encode(event: E, ctx: C): Promise<StreamEvent<To>> {
        const result = await codec.encode(event, ctx)
        const data = result.data ? encode(result.data) : undefined
        const meta = result.meta ? encode(result.meta) : undefined
        const encoded: StreamEvent<To> = { ...result, data: await data, meta: await meta }
        return encoded
      },
    }
  }

  static deflate<E, C>(codec: Codec<E, string, C>): Codec<E, [number | undefined, Uint8Array | undefined], C> {
    return Codec.map<E, string, C, [number | undefined, Uint8Array | undefined]>(
      codec,
      async (x) => {
        if (x == null) return [undefined, undefined]
        const raw = Buffer.from(x)
        const deflated = await deflate(raw)
        if (deflated.length < raw.length) return [1, deflated]
        return [0, raw]
      },
      async ([encoding, b]) => {
        if (b == null || b.length === 0) return "{}"
        const buf = Buffer.from(b)
        if (encoding === 0) return buf.toString()
        const inflated = await inflate(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
        return inflated.toString()
      }
    )
  }

  static json<E extends { type: string; data?: Record<string, any> }, C = null>(
    ctxToMeta: (ctx: C) => Record<string, any> | undefined = () => undefined
  ): Codec<E, string, C> {
    return {
      tryDecode: (e) => ({ type: e.type, data: e.data ? JSON.parse(e.data) : undefined } as E),
      encode: (e, ctx) => ({
        type: e.type,
        data: "data" in e && e.data ? JSON.stringify(e.data) : undefined,
        meta: JSON.stringify(ctxToMeta(ctx)),
      }),
    }
  }
}
