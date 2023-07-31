# Contact preferences 

This decider is used in integration tests for MessageDb

```ts
import * as Mdb from "@equinox-js/message-db"
import * as Mem from "@equinox-js/memory-store"
import { createHash } from "crypto"
import { Codec, Decider, LoadOption, ICachingStrategy } from "@equinox-js/core"
import { equals } from "ramda"


export type ClientId = string & { __brand: "ClientId" }
export const ClientId = {
  ofString: (x: string) => x as ClientId,
  toString: (x: ClientId) => x as string
}

export const Category = "ContactPreferences"
const streamId = (id: ClientId) => createHash("sha256").update(ClientId.toString(id)).digest("hex")

export type Preferences = { manyPromotions: boolean; littlePromotions: boolean; productReview: boolean; quickSurveys: boolean }
export type Value = { email: string; preferences: Preferences }

export type Event = { type: "ContactPreferencesChanged"; data: Value }
export const codec = Codec.json<Event>()

export type State = Events.Preferences
export const initial: State = {
  manyPromotions: false,
  littlePromotions: false,
  productReview: false,
  quickSurveys: false
}
const evolve = (_s: State, e: Events.Event) => {
  switch (e.type) {
    case "ContactPreferencesChanged":
      return e.data.preferences
  }
}
export const fold = (s: State, e: Events.Event[]) => (e.length ? evolve(s, e[e.length - 1]) : s)

namespace Decide {
  export const update = (value: Events.Value) => (state: Fold.State): Events.Event[] => {
    if (equals(value.preferences, state)) return []
    return [{ type: "ContactPreferencesChanged", data: value }]
  }
}

export class Service {
  constructor(private readonly resolve: (id: ClientId) => Decider<Events.Event, Fold.State>) {
  }

  update(email: ClientId, value: Events.Preferences) {
    const decider = this.resolve(email)
    return decider.transact(Decide.update({ email: email, preferences: value }))
  }

  read(email: ClientId) {
    const decider = this.resolve(email)
    return decider.query((x) => x)
  }

  readStale(email: ClientId) {
    const decider = this.resolve(email)
    return decider.query((x) => x, LoadOption.AnyCachedValue)
  }

  static createMessageDb(context: Mdb.MessageDbContext, caching: ICachingStrategy) {
    const access = Mdb.AccessStrategy.LatestKnownEvent<Event, State>()
    const category = Mdb.MessageDbCategory.create(context, codec, fold, initial, caching, access)
    const resolve = (clientId: ClientId) => Decider.resolve(category, Category, streamId(clientId), null)
    return new Service(resolve)
  }

  static createMem(store: Mem.VolatileStore<string>) {
    const category = Mem.MemoryStoreCategory.create(store, codec, fold, initial)
    const resolve = (clientId: ClientId) => Decider.resolve(category, Category, streamId(clientId), null)
    return new Service(resolve)
  }
}
```
