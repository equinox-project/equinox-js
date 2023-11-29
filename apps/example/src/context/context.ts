import { randomUUID } from "crypto"
import { ITimelineEvent } from "@equinox-js/core"

export type CorrelationContext = {
  $correlationId?: string
  $causationId?: string
}

export type Context = {
  event?: ITimelineEvent
}

export namespace Context {
  export const create = () => {
    const id = randomUUID()
    return { id, meta: { $correlationId: id, $causationId: id } }
  }

  const follow = (ev: ITimelineEvent) => {
    const meta = ev.meta ? JSON.parse(ev.meta) : {}

    return {
      $correlationId: meta.$correlationId,
      $causationId: ev.id,
    }
  }

  export const map = (_ev: unknown, ctx: Context) => {
    if (ctx.event) {
      return { meta: follow(ctx.event) }
    }
    return create()
  }
}
