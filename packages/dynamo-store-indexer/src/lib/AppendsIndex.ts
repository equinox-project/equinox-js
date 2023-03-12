import { Codec, Decider } from "@equinox-js/core"
import { AppendsEpochId, AppendsTrancheId } from "./Types"
import { DynamoStoreContext, DynamoStoreCategory, CachingStrategy, AccessStrategy } from "@equinox-js/dynamo-store"

export const Category = "$AppendsIndex"
const streamId = () => "0"

export namespace Events {
  type Started = { tranche: AppendsTrancheId.t; epoch: AppendsEpochId.t } | { partition: AppendsTrancheId.t; epoch: AppendsEpochId.t }
  export type Event = { type: "Started"; data: Started } | { type: "Snapshotted"; data: { active: Record<AppendsTrancheId.t, AppendsEpochId.t> } }

  export const codec = Codec.deflate(Codec.json<Event>())
}

export namespace Fold {
  export type State = Record<AppendsTrancheId.t, AppendsEpochId.t>
  export const initial: State = {}
  export const evolve = (state: State, event: Events.Event): State => {
    switch (event.type) {
      case "Snapshotted":
        return event.data.active
      case "Started":
        return { ...state, ["tranche" in event.data ? event.data.tranche : event.data.partition]: event.data.epoch }
    }
  }
  export const fold = (state: State, events: Events.Event[]) => events.reduce(evolve, state)
  export const isOrigin = (ev: Events.Event) => ev.type === "Snapshotted"
  export const toSnapshot = (state: State): Events.Event => ({ type: "Snapshotted", data: { active: state } })
}

export const interpret =
  (trancheId: AppendsTrancheId.t, epochId: AppendsEpochId.t) =>
  (state: Fold.State): Events.Event[] => {
    const current = state[trancheId]
    if (current != null && current < epochId && epochId > AppendsEpochId.initial)
      return [{ type: "Started", data: { partition: trancheId, epoch: epochId } }]
    return []
  }

export class Service {
  constructor(private readonly resolve: () => Decider<Events.Event, Fold.State>) {}

  /** Determines the current active epoch for the specified Tranche */
  readIngestionEpochId(trancheId: AppendsTrancheId.t): Promise<AppendsEpochId.t> {
    const decider = this.resolve()
    return decider.query((state) => state[trancheId] ?? AppendsEpochId.initial, "AllowStale")
  }

  /**
   * Mark specified `epochId` as live for the purposes of ingesting commits for the specified Tranche
   * Writers are expected to react to having writes to an epoch denied (due to it being Closed) by anointing the successor via this
   */
  markIngestionEpoch(trancheId: AppendsTrancheId.t, epochId: AppendsEpochId.t): Promise<null> {
    const decider = this.resolve()
    return decider.transact(interpret(trancheId, epochId), "AllowStale")
  }
}

export namespace Config {
  export const createCategory = (context: DynamoStoreContext, cache: CachingStrategy.CachingStrategy) =>
    DynamoStoreCategory.build(context, Events.codec, Fold.fold, Fold.initial, cache, AccessStrategy.Snapshot(Fold.isOrigin, Fold.toSnapshot))

  export const create = (context: DynamoStoreContext, cache: CachingStrategy.CachingStrategy) => {
    const category = createCategory(context, cache)
    return new Service(() => Decider.resolve(category, Category, streamId(), null))
  }
}

export namespace Reader {
  const readKnownTranches = (state: Fold.State) => Object.keys(state) as any as AppendsTrancheId.t[]

  const readIngestionEpochId = (trancheId: AppendsTrancheId.t) => (state: Fold.State) => state[trancheId] ?? AppendsEpochId.initial

  export class Service {
    constructor(private readonly resolve: () => Decider<Events.Event, Fold.State>) {}

    read() {
      const decider = this.resolve()
      return decider.query((x) => x)
    }

    readKnownTranches() {
      const decider = this.resolve()
      return decider.query(readKnownTranches)
    }

    readIngestionEpochId(trancheId: AppendsTrancheId.t) {
      const decider = this.resolve()
      return decider.query(readIngestionEpochId(trancheId))
    }
  }

  export const create = (context: DynamoStoreContext) => {
    const category = Config.createCategory(context, { type: "NoCaching" })
    return new Service(() => Decider.resolve(category, Category, streamId(), null))
  }
}
