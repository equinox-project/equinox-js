import { Draft, createDraft, enableMapSet, finishDraft } from "immer"

export function sumBy<T>(arr: T[], f: (t: T) => number): number {
  return arr.reduce((acc, t) => acc + f(t), 0)
}

type DomainEvent = { type: string; data?: any }

type ReducerMapping<Event extends DomainEvent, State> = {
  [K in Event["type"]]: (
    state: Draft<State>,
    data: Extract<Event, { type: K }>["data"],
  ) => State | void
}

enableMapSet()
export function createFold<Event extends DomainEvent, State>(
  mapping: ReducerMapping<Event, State>,
) {
  return (state: State, events: Event[]): State => {
    if (events.length === 0) return state

    let draft: any = createDraft(state as any)
    for (const event of events) {
      const handler = mapping[event.type as Event["type"]]
      const next = handler(draft, event.data)
      if (next !== undefined) {
        draft = createDraft(next as any) as any
      }
    }

    return finishDraft(draft)
  }
}

export function upcastDate(x: any): any {
  if (!x) return
  if (x.at) x.at = new Date(x.at)
  return x
}

export function upcast<T>(event: DomainEvent): T {
  return { type: event.type, data: upcastDate(event.data) } as any
}

