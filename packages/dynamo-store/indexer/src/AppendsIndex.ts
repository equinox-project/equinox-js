import {
  Codec,
  Decider,
  LoadOption,
  ICachingStrategy,
  StreamId,
  CachingStrategy,
} from "@equinox-js/core"
import { AppendsEpochId, AppendsPartitionId } from "./Identifiers.js"
import { DynamoStoreContext, DynamoStoreCategory, AccessStrategy } from "@equinox-js/dynamo-store"
import { Map } from "immutable"
import { MemoryStoreCategory, VolatileStore } from "@equinox-js/memory-store"

export namespace Stream {
  export const category = "$AppendsIndex"
  export const streamId = () => StreamId.create("0")
}

export namespace Events {
  type Started = { partition: AppendsPartitionId; epoch: AppendsEpochId }
  export type Event =
    | { type: "Started"; data: Started }
    | { type: "Snapshotted"; data: { active: Record<AppendsPartitionId, AppendsEpochId> } }

  const upcast = Codec.Upcast.body<Event>({
    Started: (x) =>
      "tranche" in x
        ? { partition: x.tranche, epoch: x.epoch }
        : { partition: x.partition, epoch: x.epoch },
    Snapshotted: (x) => x as any,
  })
  export const codec = Codec.deflate(Codec.upcast<Event>(Codec.json(), upcast))
}

export namespace Fold {
  export type State = Map<AppendsPartitionId, AppendsEpochId>
  export const initial: State = Map([])
  export const evolve = (state: State, event: Events.Event): State => {
    switch (event.type) {
      case "Snapshotted":
        return Map(event.data.active)
      case "Started":
        if ("tranche" in event.data) return state.set(event.data.partition, event.data.epoch)
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
  (partitionId: AppendsPartitionId, epochId: AppendsEpochId) =>
  (state: Fold.State): Events.Event[] => {
    const current = state.get(partitionId)
    if (current != null && current < epochId && epochId > AppendsEpochId.initial)
      return [{ type: "Started", data: { partition: partitionId, epoch: epochId } }]
    return []
  }

export class Service {
  constructor(private readonly resolve: () => Decider<Events.Event, Fold.State>) {}

  /** Determines the current active epoch for the specified Tranche */
  readIngestionEpochId(partitionId: AppendsPartitionId): Promise<AppendsEpochId> {
    const decider = this.resolve()
    return decider.query(
      (state) => state.get(partitionId) ?? AppendsEpochId.initial,
      LoadOption.AnyCachedValue,
    )
  }

  /**
   * Mark specified `epochId` as live for the purposes of ingesting commits for the specified Tranche
   * Writers are expected to react to having writes to an epoch denied (due to it being Closed) by anointing the successor via this
   */
  markIngestionEpoch(partitionId: AppendsPartitionId, epochId: AppendsEpochId): Promise<void> {
    const decider = this.resolve()
    return decider.transact(interpret(partitionId, epochId), LoadOption.AnyCachedValue)
  }

  static create(context: DynamoStoreContext, caching?: ICachingStrategy) {
    const category = createCategory(context, caching)
    return new Service(() => Decider.forStream(category, Stream.streamId(), null))
  }
  static createMem(store: VolatileStore<any>) {
    const category = createMemoryCategory(store)
    return new Service(() => Decider.forStream(category, Stream.streamId(), null))
  }
}

function createMemoryCategory(store: VolatileStore<any>) {
  return MemoryStoreCategory.create(store, Stream.category, Events.codec, Fold.fold, Fold.initial)
}

// prettier-ignore
function createCategory(context: DynamoStoreContext, caching?: ICachingStrategy) {
  const access = AccessStrategy.Snapshot(Fold.isOrigin, Fold.toSnapshot)
  return DynamoStoreCategory.create(context, Stream.category, Events.codec, Fold.fold, Fold.initial, caching, access)
}

namespace Query {
  export const readKnownPartitions = (state: Fold.State) => Array.from(state.keys())

  export const readIngestionEpochId = (partitionId: AppendsPartitionId) => (state: Fold.State) =>
    state.get(partitionId) ?? AppendsEpochId.initial
}

export class Reader {
  constructor(private readonly resolve: () => Decider<Events.Event, Fold.State>) {}

  read() {
    const decider = this.resolve()
    return decider.query((x) => x)
  }

  readKnownPartitions() {
    const decider = this.resolve()
    return decider.query(Query.readKnownPartitions)
  }

  readIngestionEpochId(partitionId: AppendsPartitionId) {
    const decider = this.resolve()
    return decider.query(Query.readIngestionEpochId(partitionId))
  }

  static create(context: DynamoStoreContext) {
    const category = createCategory(context, CachingStrategy.NoCache())
    return new Reader(() => Decider.forStream(category, Stream.streamId(), null))
  }

  static createMem(store: VolatileStore<any>) {
    const category = createMemoryCategory(store)
    return new Reader(() => Decider.forStream(category, Stream.streamId(), null))
  }
}
