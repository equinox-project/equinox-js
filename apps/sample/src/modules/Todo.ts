import { AsyncCodec, Decider } from "@equinox-js/core"
import type { StreamEvent, TimelineEvent } from "@equinox-js/core"

import { MessageDbCategory, type CachingStrategy, type MessageDbContext } from "@equinox-js/message-db"

import * as Ddb from "@equinox-js/dynamo-store"

export const Category = "Todo"
export const streamId = (id: string) => id

type Todo = { id: number; order: number; title: string; completed: boolean }
type TodoId = { id: number }
type Snapshot = { items: Todo[]; nextId: number }
type Event =
  // add a todo
  | { type: "Added"; data: Todo }
  | { type: "Completed"; data: TodoId }
  | { type: "Deleted"; data: TodoId }
  | { type: "Cleared" }
  | { type: "Snapshotted"; data: Snapshot }

const codec = {
  encode: (ev: Event): StreamEvent<any> => ev as StreamEvent<any>,
  tryDecode: (ev: TimelineEvent<any>) => ev as Event,
}

const ddbCodec = AsyncCodec.deflate({
  tryDecode: (event: TimelineEvent<Record<string, any>>) => event as Event,
  encode: (event: Event, ctx: null): StreamEvent<Record<string, any>> => ({
    type: event.type,
    data: (event as any).data ?? {},
    meta: {},
  }),
})

type State = { items: Todo[]; nextId: number }
const initial = { items: [], nextId: 0 }
const evolve = (state: State, event: Event): State => {
  switch (event.type) {
    case "Added":
      return {
        ...state,
        items: [{ ...event.data, id: state.nextId }].concat(state.items),
        nextId: state.nextId + 1,
      }
    case "Completed":
      return {
        ...state,
        items: state.items.map((x) => (x.id === event.data.id ? { ...x, completed: true } : x)),
      }
    case "Deleted":
      return {
        ...state,
        items: state.items.filter((x) => x.id !== event.data.id),
      }
    case "Cleared":
      return { ...state, items: [] }
    case "Snapshotted":
      return event.data
  }
}
const fold = (state: State, events: Event[]) => events.reduce(evolve, state)

const Decide = {
  add:
    (data: Todo) =>
    (_: State): Event[] =>
      [{ type: "Added", data }],
  complete:
    (todoId: number) =>
    (state: State): Event[] => {
      const current = state.items.find((x) => x.id === todoId)
      if (!current) throw new Error("Not found")
      if (current.completed) return []
      return [{ type: "Completed", data: { id: todoId } }]
    },
  delete:
    (id: number) =>
    (state: State): Event[] => {
      if (state.items.some((x) => x.id === id)) return [{ type: "Deleted", data: { id } }]
      return []
    },
  clear: (state: State): Event[] => (state.items.length > 0 ? [{ type: "Cleared" }] : []),
}

export class Service {
  constructor(private readonly resolve: (id: string) => Decider<Event, State>) {}

  add(id: string, todo: Todo) {
    const decider = this.resolve(id)
    return decider.transact(Decide.add(todo))
  }

  complete(id: string, todoId: number) {
    const decider = this.resolve(id)
    return decider.transact(Decide.complete(todoId))
  }

  delete(id: string, todoId: number) {
    const decider = this.resolve(id)
    return decider.transact(Decide.delete(todoId))
  }

  clear(id: string) {
    const decider = this.resolve(id)
    return decider.transact(Decide.clear)
  }

  read(id: string) {
    const decider = this.resolve(id)
    return decider.query((state) => state?.items ?? [])
  }

  static build(context: MessageDbContext, cache: CachingStrategy) {
    const category = MessageDbCategory.build<Event, State, null>(context, codec, fold, initial, cache)
    const resolve = (streamId: string) => Decider.resolve<Event, State, null>(category, Category, streamId, null)
    return new Service(resolve)
  }

  static buildDynamo(context: Ddb.DynamoStoreContext, cache: Ddb.CachingStrategy) {
    const access = Ddb.AccessStrategy.Snapshot(
      (x: Event) => x.type === "Snapshotted" || x.type === "Cleared",
      (s: State): Event => ({ type: "Snapshotted", data: { items: s.items, nextId: s.nextId } })
    )
    const category = Ddb.DynamoStoreCategory.build<Event, State, null>(context, ddbCodec, fold, initial, cache, access)
    const resolve = (streamId: string) => Decider.resolve<Event, State, null>(category, Category, streamId, null)
    return new Service(resolve)
  }
}
