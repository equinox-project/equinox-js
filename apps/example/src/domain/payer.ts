import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { PayerId } from "./identifiers.js"
import z from "zod"
import { equals } from "ramda"
import * as Config from "../config/equinox.js"
import { Context } from "../context/context.js"
import * as PayerReadModel from "../read-models/PayerReadModel.js"
import { AccessStrategy } from "@equinox-js/message-db"

export namespace Stream {
  export const category = "Payer"
  export const streamId = StreamId.gen(PayerId.toString)
  export const decodeId = StreamId.dec(PayerId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
  export const name = StreamName.gen(category, streamId)
}

export namespace Events {
  export const PayerProfile = z.object({
    name: z.string(),
    email: z.string().email(),
  })
  export type PayerProfile = z.infer<typeof PayerProfile>

  export type Event = { type: "PayerProfileUpdated"; data: PayerProfile } | { type: "PayerDeleted" }

  export const codec = Codec.upcast<Event>(
    Codec.json(Context.create),
    Codec.Upcast.body({
      PayerProfileUpdated: PayerProfile.parse,
      PayerDeleted: () => undefined,
    }),
  )
}

export namespace Fold {
  export type State = null | Events.PayerProfile
  export const initial: State = null

  export const fold = (state: State, events: Events.Event[]): State => {
    if (!events.length) return state
    const event = events[events.length - 1]
    return event.type === "PayerProfileUpdated" ? event.data : null
  }
}

export namespace Decide {
  import Event = Events.Event
  import State = Fold.State

  export const updateProfile =
    (data: Events.PayerProfile) =>
    (state: State): Event[] => {
      if (state && equals(data, state)) return []
      return [{ type: "PayerProfileUpdated", data }]
    }

  export const deletePayer = (state: State): Event[] => {
    if (state == null) return []
    return [{ type: "PayerDeleted" }]
  }
}

export class Service {
  constructor(private readonly resolve: (id: PayerId) => Decider<Events.Event, Fold.State>) {}

  updateProfile(id: PayerId, profile: Events.PayerProfile) {
    const decider = this.resolve(id)
    return decider.transact(Decide.updateProfile(profile))
  }

  deletePayer(id: PayerId) {
    const decider = this.resolve(id)
    return decider.transact(Decide.deletePayer)
  }

  readProfile(id: PayerId) {
    const decider = this.resolve(id)
    return decider.query((state) => state)
  }

  static resolveMdb(config: Extract<Config.Config, { store: Config.Store.MessageDb }>) {
    const access = AccessStrategy.AdjacentProjection<Events.Event, Fold.State>(
      PayerReadModel.project,
      AccessStrategy.LatestKnownEvent(),
    )
    return Config.MessageDb.createCached(Stream.category, Events, Fold, access, config)
  }

  // prettier-ignore
  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory: return Config.MemoryStore.create(Stream.category, Events, Fold, config)
      case Config.Store.MessageDb: return Service.resolveMdb(config)
      case Config.Store.Dynamo: return Config.Dynamo.createLatestKnown(Stream.category, Events, Fold, config)
    }
  }

  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (id: PayerId) => Decider.forStream(category, Stream.streamId(id), null)
    return new Service(resolve)
  }
}
