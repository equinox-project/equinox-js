import { createHash } from "crypto"
import { AsyncCodec, Decider } from "@equinox-js/core"
export type ClientId = string & { __brand: "ClientId" }
import { equals } from "ramda"
export const ClientId = {
  ofString: (x: string) => x as ClientId,
  toString: (x: ClientId) => x as string,
}

export const Category = "ContactPreferences"
const streamId = (id: ClientId) => createHash("sha256").update(ClientId.toString(id)).digest("hex")

export namespace Events {
  export type Preferences = { manyPromotions: boolean; littlePromotions: boolean; productReview: boolean; quickSurveys: boolean }
  export type Value = { email: string; preferences: Preferences }

  export type Event = { type: "ContactPreferencesChanged"; data: Value }

  export const codec = AsyncCodec.unsafeEmpty<Event>()
}

export namespace Fold {
  export type State = Events.Preferences
  export const initial: State = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: false }
  const evolve = (_s: State, e: Events.Event) => {
    switch (e.type) {
      case "ContactPreferencesChanged":
        return e.data.preferences
    }
  }
  export const fold = (s: State, e: Events.Event[]) => (e.length ? evolve(s, e[e.length - 1]) : s)
  export const isOrigin = () => true
  export const transmute = (events: Events.Event[], _state: State) => [[], events]
}

namespace Decide {
  export const update =
    (value: Events.Value) =>
    (state: Fold.State): Events.Event[] => {
      if (equals(value.preferences, state)) return []
      return [{ type: "ContactPreferencesChanged", data: value }]
    }
}

export class Service {
  constructor(private readonly resolve: (id: ClientId) => Decider<Events.Event, Fold.State>) {}

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
    return decider.query((x) => x, "AllowStale")
  }
}

export const create = (resolve: (cat: string, streamId: string) => Decider<Events.Event, Fold.State>) => {
  return new Service((id) => resolve(Category, streamId(id)))
}
