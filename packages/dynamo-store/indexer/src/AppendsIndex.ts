import {
  Codec,
  Decider,
  LoadOption,
  ICachingStrategy,
  StreamId,
  CachingStrategy,
} from "@equinox-js/core"
import { AppendsEpochId, AppendsTrancheId } from "./Identifiers.js"
import { DynamoStoreContext, DynamoStoreCategory, AccessStrategy } from "@equinox-js/dynamo-store"
import { Map } from "immutable"

export namespace Stream {
  export const category = "$AppendsIndex"
  export const streamId = () => StreamId.create("0")
}

export namespace Events {
  type Started =
    | { tranche: AppendsTrancheId; epoch: AppendsEpochId }
    | { partition: AppendsTrancheId; epoch: AppendsEpochId }
  export type Event =
    | { type: "Started"; data: Started }
    | { type: "Snapshotted"; data: { active: Record<AppendsTrancheId, AppendsEpochId> } }

  export const codec = Codec.deflate(Codec.json<Event>())
}

export namespace Fold {
  export type State = Map<AppendsTrancheId, AppendsEpochId>
  export const initial: State = Map([])
  export const evolve = (state: State, event: Events.Event): State => {
    switch (event.type) {
      case "Snapshotted":
        return Map(event.data.active)
      case "Started":
        if ("tranche" in event.data) return state.set(event.data.tranche, event.data.epoch)
        return state.set(event.data.partition, event.data.epoch)
    }
  }
  export const fold = (state: State, events: Events.Event[]) => events.reduce(evolve, state)
  export const isOrigin = (ev: Events.Event) => ev.type === "Snapshotted"
  export const toSnapshot = (state: State): Events.Event => ({
    type: "Snapshotted",
    data: { active: state.toObject() },
  })
}

export const interpret =
  (trancheId: AppendsTrancheId, epochId: AppendsEpochId) =>
  (state: Fold.State): Events.Event[] => {
    const current = state.get(trancheId)
    if (current != null && current < epochId && epochId > AppendsEpochId.initial)
      return [{ type: "Started", data: { partition: trancheId, epoch: epochId } }]
    return []
  }

export class Service {
  constructor(private readonly resolve: () => Decider<Events.Event, Fold.State>) {}

  /** Determines the current active epoch for the specified Tranche */
  readIngestionEpochId(trancheId: AppendsTrancheId): Promise<AppendsEpochId> {
    const decider = this.resolve()
    return decider.query(
      (state) => state.get(trancheId) ?? AppendsEpochId.initial,
      LoadOption.AnyCachedValue,
    )
  }

  /**
   * Mark specified `epochId` as live for the purposes of ingesting commits for the specified Tranche
   * Writers are expected to react to having writes to an epoch denied (due to it being Closed) by anointing the successor via this
   */
  markIngestionEpoch(trancheId: AppendsTrancheId, epochId: AppendsEpochId): Promise<void> {
    const decider = this.resolve()
    return decider.transact(interpret(trancheId, epochId), LoadOption.AnyCachedValue)
  }

  static create(context: DynamoStoreContext, caching?: ICachingStrategy) {
    const category = createCategory(context, caching)
    return new Service(() => Decider.forStream(category, Stream.streamId(), null))
  }
}

function createCategory(context: DynamoStoreContext, caching?: ICachingStrategy) {
  return DynamoStoreCategory.create(
    context,
    Stream.category,
    Events.codec,
    Fold.fold,
    Fold.initial,
    caching,
    AccessStrategy.Snapshot(Fold.isOrigin, Fold.toSnapshot),
  )
}

export namespace Reader {
  const readKnownTranches = (state: Fold.State) => Array.from(state.keys())

  const readIngestionEpochId = (trancheId: AppendsTrancheId) => (state: Fold.State) =>
    state.get(trancheId) ?? AppendsEpochId.initial

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

    readIngestionEpochId(trancheId: AppendsTrancheId) {
      const decider = this.resolve()
      return decider.query(readIngestionEpochId(trancheId))
    }
  }

  export const create = (context: DynamoStoreContext) => {
    const category = createCategory(context, CachingStrategy.NoCache())
    return new Service(() => Decider.forStream(category, Stream.streamId(), null))
  }
}
