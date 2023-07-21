import { Codec, Decider, LoadOption, StreamId } from "@equinox-js/core"
import { PayerId } from "./identifiers.js"
import z from "zod"
import { equals } from "ramda"
import * as Config from "../config/equinox.js"

const CATEGORY = "Payer"
const streamId = StreamId.gen(PayerId.toString)

export const PayerProfileSchema = z.object({
  name: z.string(),
  email: z.string().email(),
})
type PayerProfile = z.infer<typeof PayerProfileSchema>

export type Event = { type: "PayerProfileUpdated"; data: PayerProfile } | { type: "PayerDeleted" }
export const codec = Codec.zod<Event>({
  PayerProfileUpdated: PayerProfileSchema.parse,
  PayerDeleted: () => undefined,
})

type State = null | PayerProfile
const initial: State = null
const fold = (state: State, events: Event[]): State => {
  if (!events.length) return state
  const event = events[events.length - 1]
  return event.type === "PayerProfileUpdated" ? event.data : null
}

const updateProfile =
  (data: PayerProfile) =>
  (state: State): Event[] => {
    if (state && equals(data, state)) return []
    return [{ type: "PayerProfileUpdated", data }]
  }

export const deletePayer = (state: State): Event[] => {
  if (state == null) return [{ type: "PayerDeleted" }]
  return []
}

export class Service {
  constructor(private readonly resolve: (id: PayerId) => Decider<Event, State>) {}

  updateProfile(id: PayerId, profile: PayerProfile) {
    const decider = this.resolve(id)
    return decider.transact(updateProfile(profile))
  }

  deletePayer(id: PayerId) {
    const decider = this.resolve(id)
    return decider.transact(deletePayer)
  }

  readProfile(id: PayerId) {
    const decider = this.resolve(id)
    return decider.query((state) => state, LoadOption.AllowStale)
  }

  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory:
        return Config.MemoryStore.create(codec, fold, initial, config)
      case Config.Store.MessageDb:
        return Config.MessageDb.createLatestKnown(codec, fold, initial, config)
    }
  }

  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (id: PayerId) => Decider.resolve(category, CATEGORY, streamId(id), null)
    return new Service(resolve)
  }
}
