import { IEventData, ITimelineEvent } from "./Types.js"
import zlib from "zlib"

export interface ICodec<E, F, C = void> {
  decode(event: ITimelineEvent<F>): E | undefined
  encode(event: E, ctx: C): IEventData<F>
}

type DomainEvent = IEventData<Record<string, any>>
type MapMeta<E, C> = (
  e: E,
  ctx: C,
) => {
  id?: string
  meta?: Record<string, any>
}

/** Naive json codec, will stringify data and meta */
export function json<E extends DomainEvent>(): ICodec<E, string, void>
export function json<E extends DomainEvent, C>(mapMeta: MapMeta<E, C>): ICodec<E, string, C>
export function json(mapMeta?: MapMeta<any, any>): ICodec<any, string, any> {
  return {
    decode: (e) => ({ type: e.type, data: e.data ? JSON.parse(e.data) : undefined }),
    encode(e, _ctx) {
      let id = e.id
      let meta = e.meta
      if (mapMeta) {
        const mapped = mapMeta(e, _ctx)
        if (mapped.id) id = mapped.id
        if (mapped.meta) meta = mapped.meta
      }
      return {
        id,
        type: e.type,
        data: "data" in e && e.data ? JSON.stringify(e.data) : undefined,
        meta: meta ? JSON.stringify(meta) : undefined,
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

export const upcast = <E extends DomainEvent, Ctx = void>(
  codec: ICodec<DomainEvent, string, Ctx>,
  upcast: (e: DomainEvent) => E | undefined,
): ICodec<E, string, Ctx> => {
  return {
    decode: (e: ITimelineEvent<string>) => {
      const decoded = codec.decode(e)
      if (!decoded) return
      return upcast(decoded)
    },
    encode: codec.encode,
  }
}

export function keep<E extends DomainEvent, Ctx = void>(
  codec: ICodec<DomainEvent, string, Ctx>,
  keep: (e: DomainEvent) => e is E,
): ICodec<E, string, Ctx> {
  return {
    decode: (e: ITimelineEvent<string>) => {
      const decoded = codec.decode(e)
      if (!decoded || !keep(decoded)) return undefined
      return decoded
    },
    encode: codec.encode,
  }
}

// Cursed type level programming zone
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

type LastOf<T> =
  UnionToIntersection<T extends any ? () => T : never> extends () => infer R ? R : never

type Push<T extends any[], V> = [...T, V]

type UnionToTuple<T, L = LastOf<T>, N = [T] extends [never] ? true : false> = true extends N
  ? []
  : Push<UnionToTuple<Exclude<T, L>>, L>

export function keepTypes<E extends DomainEvent, Ctx = void>(
  codec: ICodec<DomainEvent, string, Ctx>,
  types: UnionToTuple<E["type"]>,
): ICodec<E, string, Ctx> {
  const known = new Set(types as string[])
  return keep(codec, (e): e is E => known.has(e.type))
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
    decode(e) {
      const data = e.data ? smartDecompress(e.data)?.toString() : undefined
      const meta = e.meta ? smartDecompress(e.meta)?.toString() : undefined
      return codec.decode({ ...e, data, meta })
    },
    encode(e, ctx) {
      const inner = codec.encode(e, ctx)
      const data = inner.data ? smartCompress(inner.data) : undefined
      const meta = inner.meta ? smartCompress(inner.meta) : undefined
      return { ...inner, data, meta }
    },
  }
}
