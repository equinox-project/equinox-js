import { IEventData, ITimelineEvent } from "./Types.js"

export interface ICodec<E, F, C = undefined> {
  tryDecode(event: ITimelineEvent<F>): E | undefined
  encode(event: E, ctx: C): IEventData<F>
}

type DomainEvent = IEventData<Record<string, any>>

/** Naive json codec, will stringify data and meta */
export const json = <E extends DomainEvent>(): ICodec<E, string, any> => {
  return {
    tryDecode: (e) => ({ type: e.type, data: e.data ? JSON.parse(e.data) : undefined }) as E,
    encode: (e, _ctx) => ({
      id: e.id,
      type: e.type,
      data: "data" in e && e.data ? JSON.stringify(e.data) : undefined,
      meta: "meta" in e && e.meta ? JSON.stringify(e.meta) : undefined,
    }),
  }
}

export namespace Decode {
  /** Trust that the body can be decoded an will match your domain event type */
  export const json =
    <E extends DomainEvent>() =>
    (e: ITimelineEvent): E & { meta: never; id: never } => {
      const data = e.data ? JSON.parse(e.data) : undefined
      const meta = e.meta ? JSON.parse(e.meta) : undefined
      return { type: e.type, data } as any
    }

  /**
   * Given a mapping from event type to a decoder for that type
   * will try to decode the event and return the decoded event or undefined
   */
  export const from =
    <E extends DomainEvent>(mapping: {
      [P in E["type"]]: (obj: unknown) => Extract<E, { type: P }>["data"] | undefined
    }) =>
    (event: ITimelineEvent): E | undefined => {
      const decode = mapping[event.type as E["type"]]
      if (!decode) return
      if (!event.data) return { type: event.type } as E
      const decoded = decode(JSON.parse(event.data))
      return { type: event.type, data: decoded } as E
    }
}

export namespace Encode {
  /** Navively stringify the event data and meta */
  export function stringify<E extends DomainEvent, M>(e: E, maybeMeta: M): IEventData<string> {
    const data = e.data ? JSON.stringify(e.data) : undefined
    const meta = maybeMeta ? JSON.stringify(maybeMeta) : undefined
    return { type: e.type, data, meta, id: e.id }
  }

  /**
   * Runs the supplied encoder for the event type
   * useful if you have event bodies that don't roundtrip
   * cleanly through json
   */
  export const from =
    <E extends DomainEvent>(mapping: {
      [P in E["type"]]: (obj: Extract<E, { type: P }>["data"]) => Record<string, any> | undefined
    }) =>
    <M,>(e: E, meta: M) => {
      const encode = mapping[e.type as E["type"]]
      if (!encode) throw new Error(`No encoder for event type ${e.type}`)
      const event = { type: e.type, data: encode(e.data), meta: e.meta, id: e.id }
      return stringify(event, meta)
    }
}

/**
 * create a Codec with Extended options
 * @param up a function that takes a timeline event and returns a domain event or undefined
 * @param down a function that takes a domain event and returns a timeline event
 * @param mapMeta a function that takes a domain event and a context and returns a meta
 * @returns a Codec
 */
export const createEx = <E extends DomainEvent, Meta, Context, Format = string>(
  up: (e: ITimelineEvent<Format>) => E | undefined,
  down: (e: E, meta: Meta) => IEventData<Format>,
  mapMeta: (e: E, ctx: Context) => Meta,
): ICodec<E, Format, Context> => ({
  tryDecode: up,
  encode(e, ctx) {
    const meta = mapMeta(e, ctx)
    return down(e, meta)
  },
})

/**
 * create a Codec with simple options. Usually used with
 * Codec.Decode.from and Codec.Encode.stringify
 * @param up a function that takes a timeline event and returns a domain event or undefined
 * @param down a function that takes a domain event and returns a timeline event
 * @returns a Codec
 */
export const create = <Event extends DomainEvent>(
  up: (e: ITimelineEvent) => Event | undefined,
  down: (e: Event, meta: undefined) => IEventData,
): ICodec<Event, string, undefined | null> =>
  createEx<Event, undefined, undefined, string>(up, down, () => undefined)

type StraightMapper<E> = (e: unknown) => E
type SerdeMapper<E> = [(e: unknown) => E, (e: E) => Record<string, any>]

const pickParse = <K extends string, E>(
  e: Record<K, StraightMapper<E> | SerdeMapper<E>>,
): Record<K, StraightMapper<E>> => {
  const result: Record<K, StraightMapper<E>> = {} as any
  for (const key of Object.keys(e) as K[]) {
    const value: StraightMapper<E> | SerdeMapper<E> = e[key]
    if (Array.isArray(value)) {
      result[key] = value[0]
    } else {
      result[key] = value
    }
  }
  return result
}

const pickEncode = <K extends string, E>(
  e: Record<K, StraightMapper<E> | SerdeMapper<E>>,
): Record<K, (e: E) => Record<string, any>> => {
  const result: Record<K, (e: E) => Record<string, any>> = {} as any
  for (const key of Object.keys(e) as K[]) {
    const value: StraightMapper<E> | SerdeMapper<E> = e[key]
    if (Array.isArray(value)) {
      result[key] = value[1]
    } else {
      result[key] = value as any
    }
  }
  return result
}

export type CodecMapping<E extends DomainEvent> = {
  [P in E["type"]]:
    | StraightMapper<Extract<E, { type: P }>["data"]>
    | SerdeMapper<Extract<E, { type: P }>["data"]>
}

export function from<E extends DomainEvent>(mapping: CodecMapping<E>): ICodec<E, string, null>
export function from<E extends DomainEvent, Context, Meta>(
  mapping: CodecMapping<E>,
  mapMeta: (e: E, ctx: Context) => Meta,
): ICodec<E, string, Context>
export function from<E extends DomainEvent>(
  mapping: CodecMapping<E>,
  mapMeta?: (e: E, ctx: any) => any,
) {
  const up = Decode.from(pickParse(mapping))
  const down = Encode.from(pickEncode(mapping))
  if (mapMeta === undefined) return create(up, down)
  return createEx(up, down, mapMeta)
}
