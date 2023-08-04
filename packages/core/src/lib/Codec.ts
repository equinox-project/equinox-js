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
  export function json<E extends DomainEvent>(e: ITimelineEvent): E {
    const data = e.data ? JSON.parse(e.data) : undefined
    const meta = e.meta ? JSON.parse(e.meta) : undefined
    return { type: e.type, data, meta, id: e.id } as E
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
      [P in E["type"]]: (obj: Extract<E, { type: P }>) => IEventData<Record<string, any>>
    }) =>
    <M,>(e: E, meta: M) => {
      const encode = mapping[e.type as E["type"]]
      if (!encode) throw new Error(`No encoder for event type ${e.type}`)
      return stringify(encode(e as any), meta)
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
