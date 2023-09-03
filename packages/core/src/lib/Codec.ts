import { IEventData, ITimelineEvent } from "./Types.js"
import * as zlib from "zlib"

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

export function deflate<E, C>(codec: ICodec<E, string, C>): ICodec<E, Buffer, C> {
  return {
    tryDecode(e) {
      const data = e.data ? zlib.inflateSync(e.data).toString() : undefined
      const meta = e.meta ? zlib.inflateSync(e.meta).toString() : undefined
      return codec.tryDecode({ ...e, data, meta })
    },
    encode(e, ctx) {
      const inner = codec.encode(e, ctx)
      const data = inner.data ? zlib.deflateSync(inner.data) : undefined
      const meta = inner.meta ? zlib.deflateSync(inner.meta) : undefined
      return { ...inner, data, meta }
    },
  }
}
