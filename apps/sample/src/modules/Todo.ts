import { Codec, Decider } from "@equinox-js/core"
import * as Ddb from "@equinox-js/dynamo-store"

export const Category = "Todo"
export const streamId = (id: string) => id

namespace Events {
  export type Todo = { id: number; order: number; title: string; completed: boolean }
  export type TodoId = { id: number }
  export type Snapshot = { items: Todo[]; nextId: number }
  export type Event =
    | { type: "Added"; data: Todo }
    | { type: "Completed"; data: TodoId }
    | { type: "Deleted"; data: TodoId }
    | { type: "Cleared" }
    | { type: "Snapshotted"; data: Snapshot }

  export const codec = Codec.deflate(Codec.json<Event>())
}

namespace Fold {
  export type State = { items: Events.Todo[]; nextId: number }
  export const initial: State = { items: [], nextId: 0 }
  const evolve = (state: State, event: Events.Event): State => {
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

  export const fold = (state: State, events: Events.Event[]) => events.reduce(evolve, state)
  export const isOrigin = (event: Events.Event) => event.type === "Snapshotted" || event.type === "Cleared"
  export const toSnapshot = (state: State): Events.Event => ({ type: "Snapshotted", data: state })
}

export namespace Decide {
  export const add =
    (data: Events.Todo) =>
    (_: Fold.State): Events.Event[] =>
      [{ type: "Added", data }]
  export const complete =
    (todoId: number) =>
    (state: Fold.State): Events.Event[] => {
      const current = state.items.find((x) => x.id === todoId)
      if (!current) throw new Error("Not found")
      if (current.completed) return []
      return [{ type: "Completed", data: { id: todoId } }]
    }

  export const delete_ =
    (id: number) =>
    (state: Fold.State): Events.Event[] => {
      if (state.items.some((x) => x.id === id)) return [{ type: "Deleted", data: { id } }]
      return []
    }
  export const clear = (state: Fold.State): Events.Event[] => (state.items.length > 0 ? [{ type: "Cleared" }] : [])
}

export class Service {
  constructor(private readonly resolve: (id: string) => Decider<Events.Event, Fold.State>) {}

  add(id: string, todo: Events.Todo) {
    const decider = this.resolve(id)
    return decider.transact(Decide.add(todo))
  }

  complete(id: string, todoId: number) {
    const decider = this.resolve(id)
    return decider.transact(Decide.complete(todoId))
  }

  delete(id: string, todoId: number) {
    const decider = this.resolve(id)
    return decider.transact(Decide.delete_(todoId))
  }

  clear(id: string) {
    const decider = this.resolve(id)
    return decider.transact(Decide.clear)
  }

  read(id: string) {
    const decider = this.resolve(id)
    return decider.query((state) => state?.items ?? [])
  }
}

export const create = (context: Ddb.DynamoStoreContext, cache: Ddb.CachingStrategy.CachingStrategy) => {
  const access = Ddb.AccessStrategy.Snapshot(Fold.isOrigin, Fold.toSnapshot)
  const category = Ddb.DynamoStoreCategory.build(context, Events.codec, Fold.fold, Fold.initial, cache, access)
  const resolve = (streamId: string) => Decider.resolve(category, Category, streamId, null)
  return new Service(resolve)
}
