import { IEventData, ITimelineEvent } from "./Types.js"
import zlib from "zlib"

export interface ICodec<E, F, C = undefined> {
  tryDecode(event: ITimelineEvent<F>): E | undefined
  encode(event: E, ctx: C): IEventData<F>
}

type DomainEvent = IEventData<Record<string, any>>
type MapMeta<E, C> = (e: E, ctx: C) => Record<string, any>

/** Naive json codec, will stringify data and meta */
export function json<E extends DomainEvent>(): ICodec<E, string, null>
export function json<E extends DomainEvent, C>(mapMeta: MapMeta<E, C>): ICodec<E, string, C>
export function json(mapMeta?: MapMeta<any, any>): ICodec<any, string, any> {
  return {
    tryDecode: (e) => ({ type: e.type, data: e.data ? JSON.parse(e.data) : undefined }),
    encode(e, _ctx) {
      const meta = JSON.stringify(mapMeta ? mapMeta(e, _ctx) : e.meta)
      return {
        id: e.id,
        type: e.type,
        data: "data" in e && e.data ? JSON.stringify(e.data) : undefined,
        meta,
      }
    },
  }
}

type FromRecord<E> = (e: Record<string, any>) => E

export type CodecMapping<E extends DomainEvent> = {
  [P in E["type"]]: FromRecord<Extract<E, { type: P }>["data"]>
}

export namespace Upcast {
  export const body =
    <E extends DomainEvent>(mapping: CodecMapping<E>) =>
    (e: DomainEvent): E | undefined => {
      const upcast = mapping[e.type as E["type"]]
      if (!upcast) return
      const data = e.data ? upcast(e.data) : undefined
      return { type: e.type, data } as E
    }
}

export const upcast = <E extends DomainEvent, Ctx = null>(
  codec: ICodec<DomainEvent, string, Ctx>,
  upcast: (e: DomainEvent) => E | undefined,
): ICodec<E, string, Ctx> => {
  return {
    tryDecode: (e: ITimelineEvent<string>) => {
      const decoded = codec.tryDecode(e)
      if (!decoded) return
      return upcast(decoded)
    },
    encode: codec.encode,
  }
}

export enum Encoding {
  Raw = 0,
  Deflate = 1,
  Brotli = 2,
}

export type EncodedBody = {
  encoding: number
  body: Buffer
}

export function smartDecompress(b: EncodedBody) {
  if (!b.body?.length) return undefined
  switch (b.encoding) {
    case Encoding.Raw:
      return Buffer.from(b.body)
    case Encoding.Deflate:
      // compatible with the F# deflate implementation
      return zlib.inflateRawSync(b.body, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
    case Encoding.Brotli:
      return zlib.brotliDecompressSync(b.body)
    default:
      // unknown encoding, return as-is
      return Buffer.from(b.body)
  }
}

export function smartCompress(buf: Buffer | string): EncodedBody {
  if (buf.length > 48) {
    // Quality level 6 is based on google's nginx default value for on-the-fly compression
    const compressed = zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
    })
    if (compressed.length < buf.length) return { encoding: Encoding.Brotli, body: compressed }
  }
  return { encoding: Encoding.Raw, body: Buffer.from(buf) }
}

export function compress<E, C>(codec: ICodec<E, string, C>): ICodec<E, EncodedBody, C> {
  return {
    tryDecode(e) {
      const data = e.data ? smartDecompress(e.data)?.toString() : undefined
      const meta = e.meta ? smartDecompress(e.meta)?.toString() : undefined
      return codec.tryDecode({ ...e, data, meta })
    },
    encode(e, ctx) {
      const inner = codec.encode(e, ctx)
      const data = inner.data ? smartCompress(inner.data) : undefined
      const meta = inner.meta ? smartCompress(inner.meta) : undefined
      return { ...inner, data, meta }
    },
  }
}
