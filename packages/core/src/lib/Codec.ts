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
