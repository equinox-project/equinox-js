import { Codec, Decider } from "@equinox-js/core"

export const Category = "Cart"
export type CartId = string & { __brand: "CartId" }
export type SkuId = string
export const CartId = {
  ofString: (x: string) => x as CartId,
  toString: (x: CartId) => x.replace(/-/g, ""), // (equivalent to dotnet's "N" guid format)
}
const streamId = (cartId: CartId) => CartId.toString(cartId) as string

export namespace Events {
  export type ContextInfo = { time: string; requestId: string }
  type ItemAddedInfo = { context: ContextInfo; skuId: SkuId; quantity: number; waived?: boolean }

  type ItemRemovedInfo = { context: ContextInfo; skuId: SkuId }
  type ItemQuantityChangedInfo = { context: ContextInfo; skuId: SkuId; quantity: number }
  type ItemPropertiesChangedInfo = { context: ContextInfo; skuId: SkuId; waived: boolean }
  export namespace Compaction {
    type StateItemInfo = { skuId: SkuId; quantity: number; returnsWaived?: boolean }
    export type State = { items: StateItemInfo[] }
  }

  export type Event =
    | { type: "Snapshotted"; data: Compaction.State }
    | { type: "ItemAdded"; data: ItemAddedInfo }
    | { type: "ItemRemoved"; data: ItemRemovedInfo }
    | { type: "ItemQuantityChanged"; data: ItemQuantityChangedInfo }
    | { type: "ItemPropertiesChanged"; data: ItemPropertiesChangedInfo }

  export const codec: Codec<Event, Record<string, any>, null> = {
    tryDecode(event) {
      return event as any as Event
    },
    encode(event: Event) {
      return { type: event.type, data: event.data, meta: {} }
    },
  }
  export const asyncCodec = Codec.deflate(codec)
}

export namespace Fold {
  export type ItemInfo = { skuId: SkuId; quantity: number; returnsWaived?: boolean }
  export type State = { items: ItemInfo[] }
  export const toSnapshot = (s: State): Events.Compaction.State => ({ items: s.items })
  export const ofSnapshot = (s: Events.Compaction.State) => ({ items: s.items })
  export const initial = { items: [] }
  export const snapshotEventType = "Snapshotted"
  export const evolve = (state: State, event: Events.Event): State => {
    const updateItems = (f: (items: ItemInfo[]) => ItemInfo[]) => ({ ...state, items: f(state.items) })
    switch (event.type) {
      case "Snapshotted":
        return ofSnapshot(event.data)
      case "ItemAdded":
        return updateItems((items) => [event.data, ...items])
      case "ItemRemoved":
        return updateItems((items) => items.filter((x) => x.skuId !== event.data.skuId))
      case "ItemQuantityChanged":
        return updateItems((items) => items.map((x) => (x.skuId === event.data.skuId ? { ...x, quantity: event.data.quantity } : x)))
      case "ItemPropertiesChanged":
        return updateItems((items) => items.map((x) => (x.skuId === event.data.skuId ? { ...x, returnsWaived: event.data.waived } : x)))
    }
  }
  export const fold = (state: State, events: Events.Event[]) => events.reduce(evolve, state)
  export const isOrigin = (x: Events.Event) => x.type === "Snapshotted"
  export const snapshot = (s: State): Events.Event => ({ type: "Snapshotted", data: s })
}

export type Context = { time: Date; requestId: string }
type Command = { type: "SyncItem"; context: Context; skuId: SkuId; quantity?: number; waived?: boolean }

export const interpret =
  (command: Command) =>
  (state: Fold.State): Events.Event[] => {
    const itemExists = (f: (x: Fold.ItemInfo) => boolean) => state.items.some(f)
    const itemExistsWithDifferentWaiveStatus = (skuId: SkuId, waive: boolean) => itemExists((x) => x.skuId === skuId && x.returnsWaived !== waive)
    const itemExistsWithDifferentQuantity = (skuId: SkuId, quantity: number) => itemExists((x) => x.skuId === skuId && x.quantity !== quantity)
    const itemExistsWithSkuId = (skuId: SkuId) => itemExists((x) => x.skuId === skuId)
    const toEventContext = (reqContext: Context): Events.ContextInfo => ({
      time: reqContext.time.toISOString(),
      requestId: reqContext.requestId,
    })
    const maybePropChanges = (context: Events.ContextInfo, skuId: SkuId, waived?: boolean): Events.Event[] => {
      if (waived == null) return []
      if (!itemExistsWithDifferentWaiveStatus(skuId, waived)) return []
      return [{ type: "ItemPropertiesChanged", data: { context, skuId, waived } }]
    }
    const maybeQuantityChanges = (context: Events.ContextInfo, skuId: SkuId, quantity: number): Events.Event[] => {
      if (!itemExistsWithDifferentQuantity(skuId, quantity)) return []
      return [{ type: "ItemQuantityChanged", data: { context, skuId, quantity } }]
    }

    switch (command.type) {
      case "SyncItem": {
        const context = toEventContext(command.context)
        const { skuId, waived, quantity } = command
        if (quantity === 0 && itemExistsWithSkuId(skuId)) return [{ type: "ItemRemoved", data: { context, skuId } }]
        if (quantity != null && itemExistsWithSkuId(skuId))
          return [...maybeQuantityChanges(context, skuId, quantity), ...maybePropChanges(context, skuId, waived)]
        if (quantity != null) return [{ type: "ItemAdded", data: { context, skuId, quantity, waived } }]
        return maybePropChanges(context, skuId, waived)
      }
    }
  }

const interpretMany =
  <S, E>(fold: (s: S, es: E[]) => S, interpreters: ((s: S) => E[])[]) =>
  (state: S): [S, E[]] => {
    const result: E[] = []
    for (const interpret of interpreters) {
      const events = interpret(state)
      state = fold(state, events)
      result.push(...events)
    }
    return [state, result]
  }

export class Service {
  constructor(private readonly resolve: (id: CartId) => Decider<Events.Event, Fold.State>) {}

  run(cartId: CartId, optimistic: boolean, commands: Command[], prepare?: () => Promise<void>) {
    const decider = this.resolve(cartId)
    const interpretCommands = async (state: Fold.State): Promise<[Fold.State, Events.Event[]]> => {
      if (prepare) await prepare()
      return interpretMany(Fold.fold, commands.map(interpret))(state)
    }
    const opt = optimistic ? "AllowStale" : "RequireLoad"
    return decider.transactResultAsync(interpretCommands, opt)
  }

  executeManyAsync(cartId: CartId, optimistic: boolean, commands: Command[], prepare?: () => Promise<void>): Promise<void> {
    return this.run(cartId, optimistic, commands, prepare).then(() => undefined)
  }

  execute(cartId: CartId, command: Command) {
    return this.executeManyAsync(cartId, false, [command])
  }

  read(cartId: CartId) {
    const decider = this.resolve(cartId)
    return decider.query((x) => x)
  }

  readStale(cartId: CartId) {
    const decider = this.resolve(cartId)
    return decider.query((x) => x, "AllowStale")
  }
}

export const create = (resolve: (cat: string, streamId: string) => Decider<Events.Event, Fold.State>) => {
  return new Service((id) => resolve(Category, streamId(id)))
}
