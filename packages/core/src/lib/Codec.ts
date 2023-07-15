import { IEventData, ITimelineEvent } from "./Types.js"

export interface ICodec<E, F, C = undefined> {
  tryDecode(event: ITimelineEvent<F>): E | undefined
  encode(event: E, ctx: C): IEventData<F>
}

export const json = <E extends { type: string; data?: Record<string, any> }, C = null>(
  ctxToMeta: (ctx: C) => Record<string, any> | undefined = () => undefined
): ICodec<E, string, C> => {
  return {
    tryDecode: (e) => ({ type: e.type, data: e.data ? JSON.parse(e.data) : undefined } as E),
    encode: (e, ctx) => ({
      type: e.type,
      data: "data" in e && e.data ? JSON.stringify(e.data) : undefined,
      meta: JSON.stringify(ctxToMeta(ctx)),
    }),
  }
}

export const zod = <K extends string, E extends { type: K; data?: Record<string, any> }, C = null>(
  mapping: { [P in K]: (obj: unknown) => Extract<E, { type: P }>["data"] | undefined },
  ctxToMeta: (ctx: C) => Record<string, any> | undefined = () => undefined
): ICodec<E, string, C> => {
  return {
    tryDecode(event: ITimelineEvent<string>): E | undefined {
      const decode = mapping[event.type as K]
      if (!decode) return
      if (!event.data) return { type: event.type } as E
      try {
        const decoded = decode(JSON.parse(event.data))
        return { type: event.type, data: decoded } as E
      } catch (err) {
        return undefined
      }
    },
    encode: (e, ctx) => {
      const parse = mapping[e.type]
      const data = e.data ? JSON.stringify(parse(e.data)) : undefined
      return {
        type: e.type,
        data,
        meta: JSON.stringify(ctxToMeta(ctx)),
      }
    },
  }
}
