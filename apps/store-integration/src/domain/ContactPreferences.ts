import { createHash } from "crypto"
import { equals } from "ramda"
import { Codec, Decider } from "@equinox-js/core"
import * as Equinox from "@equinox-js/core"

export type ClientId = string & { __brand: "ClientId" }
export const ClientId = {
  ofString: (x: string) => x as ClientId,
  toString: (x: ClientId) => x as string,
}

export const Category = "ContactPreferences"
const streamId = (id: ClientId) => createHash("sha256").update(ClientId.toString(id)).digest("hex")

export type Preferences = { manyPromotions: boolean; littlePromotions: boolean; productReview: boolean; quickSurveys: boolean }
export type Value = { email: string; preferences: Preferences }

export type Event = { type: "ContactPreferencesChanged"; data: Value }
export const codec = Codec.json<Event>()

export type State = Preferences
export const initial: State = { manyPromotions: false, littlePromotions: false, productReview: false, quickSurveys: false }
const evolve = (_s: State, e: Event) => {
  switch (e.type) {
    case "ContactPreferencesChanged":
      return e.data.preferences
  }
}
export const fold = (s: State, e: Event[]) => (e.length ? evolve(s, e[e.length - 1]) : s)
export const isOrigin = () => true
export const transmute = (events: Event[], _state: State) => [[], events]

namespace Decide {
  export const update =
    (value: Value) =>
    (state: State): Event[] => {
      if (equals(value.preferences, state)) return []
      return [{ type: "ContactPreferencesChanged", data: value }]
    }
}

export class Service {
  constructor(private readonly resolve: (id: ClientId) => Decider<Event, State>) {}

  update(email: ClientId, value: Preferences) {
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

  static create(category: Equinox.Category<Event, State>) {
    const resolve = (clientId: ClientId) => Decider.resolve(category, Category, streamId(clientId), null)
    return new Service(resolve)
  }
}
