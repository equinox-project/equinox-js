import {
  CachingStrategy,
  Codec,
  Decider,
  ICache,
  LoadOption,
  StreamId,
  StreamName,
} from "@equinox-js/core"
import { AccessStrategy, DynamoStoreCategory, DynamoStoreContext } from "@equinox-js/dynamo-store"
import { AppendsPartitionId, Checkpoint } from "@equinox-js/dynamo-store-indexer"
import { ICheckpoints } from "@equinox-js/propeller"

namespace Stream {
  export const category = "$ReaderCheckpoint"
  export const streamId = StreamId.gen(AppendsPartitionId.toString, (x: string) => x)
  export const name = StreamName.gen(category, streamId)
}

namespace Events {
  export type Config = { checkpointFreqS: number }
  export type Checkpoint = { at: Date; nextCheckpointDue: Date; pos: string }

  export type Started = { config: Config; origin: Checkpoint }
  export type Updated = { config: Config; pos: Checkpoint }
  export type Snapshotted = { config: Config; state: Checkpoint }
  const Checkpoint = (x: Record<string, any>): Checkpoint => ({
    at: new Date(x.at),
    nextCheckpointDue: new Date(x.nextCheckpointDue),
    pos: x.pos,
  })
  const Started = (x: Record<string, any>): Started => ({
    config: { checkpointFreqS: x.config.checkpointFreqS },
    origin: Checkpoint(x.origin),
  })
  const Updated = (x: Record<string, any>): Updated => ({
    config: { checkpointFreqS: x.config.checkpointFreqS },
    pos: Checkpoint(x.pos),
  })
  const Snapshotted = (x: Record<string, any>): Snapshotted => ({
    config: { checkpointFreqS: x.config.checkpointFreqS },
    state: Checkpoint(x.state),
  })

  export type Event =
    | { type: "Started"; data: Started }
    | { type: "Overridden"; data: Updated }
    | { type: "Checkpointed"; data: Updated }
    | { type: "Updated"; data: Updated }
    | { type: "Snapshotted"; data: Snapshotted }

  export const codec = Codec.compress(
    Codec.upcast<Event>(
      Codec.json(),
      Codec.Upcast.body({
        Started: Started,
        Overridden: Updated,
        Checkpointed: Updated,
        Updated: Updated,
        Snapshotted: Snapshotted,
      }),
    ),
  )
}

namespace Fold {
  export type State = { type: "NotStarted" } | { type: "Running"; data: Events.Snapshotted }

  export const initial: State = { type: "NotStarted" }
  const evolve = (state: State, event: Events.Event): State => {
    switch (event.type) {
      case "Started":
        return { type: "Running", data: { config: event.data.config, state: event.data.origin } }
      case "Overridden":
      case "Checkpointed":
      case "Updated":
        return { type: "Running", data: { config: event.data.config, state: event.data.pos } }
      case "Snapshotted":
        return { type: "Running", data: event.data }
    }
  }
  export const fold = (state: State, event: Events.Event[]): State => event.reduce(evolve, state)
  export const isOrigin = () => true
  export const toSnapshot = (state: State): Events.Event => {
    switch (state.type) {
      case "NotStarted":
        throw new Error("Cannot snapshot NotStarted")
      case "Running":
        return { type: "Snapshotted", data: state.data }
    }
  }
  export const transmute = (
    events: Events.Event[],
    state: State,
  ): [Events.Event[], Events.Event[]] => {
    if (events.length === 1 && events[0].type === "Updated") {
      return [[], [toSnapshot(state)]]
    }
    return [events, [toSnapshot(state)]]
  }
}

const mkCheckpoint = (at: Date, next: Date, pos: bigint): Events.Checkpoint => ({
  at: at,
  nextCheckpointDue: next,
  pos: pos.toString(),
})

const mk = (at: Date, interval: number, pos: bigint): [Events.Config, Events.Checkpoint] => {
  const intervalMs = interval * 1000
  const next = new Date(+at + intervalMs)
  return [{ checkpointFreqS: interval }, mkCheckpoint(at, next, pos)]
}
const configFreq = (config: Events.Config): number => config.checkpointFreqS

namespace Decide {
  export const start =
    (establishOrigin: () => Promise<bigint>, at: Date, freqS: number) =>
    async (state: Fold.State): Promise<[bigint, Events.Event[]]> => {
      switch (state.type) {
        case "NotStarted":
          const pos = await establishOrigin()
          const [config, checkpoint] = mk(at, freqS, pos)
          return [pos, [{ type: "Started", data: { config: config, origin: checkpoint } }]]
        case "Running":
          return [BigInt(state.data.state.pos), []]
      }
    }

  export const override =
    (at: Date, freqS: number, pos: bigint) =>
    (state: Fold.State): Events.Event[] => {
      if (
        state.type === "Running" &&
        state.data.config.checkpointFreqS === freqS &&
        BigInt(state.data.state.pos) === pos
      )
        return []
      const [config, checkpoint] = mk(at, freqS, pos)
      return [{ type: "Overridden", data: { config: config, pos: checkpoint } }]
    }

  export const update =
    (at: Date, pos: bigint) =>
    (state: Fold.State): Events.Event[] => {
      const result: Events.Event[] = []
      switch (state.type) {
        case "NotStarted":
          throw new Error("Cannot update NotStarted")
        case "Running":
          if (at < state.data.state.nextCheckpointDue) {
            if (pos !== BigInt(state.data.state.pos)) {
              // prettier-ignore
              result.push({
                type: "Updated",
                data: { config: state.data.config, pos: mkCheckpoint(at, state.data.state.nextCheckpointDue, pos) },
              })
            }
          } else {
            // Checkpoint due => Force a write every N seconds regardless of whether the position has actually changed
            const [config, checkpoint] = mk(at, configFreq(state.data.config), pos)
            result.push({ type: "Checkpointed", data: { config: config, pos: checkpoint } })
          }
          return result
      }
    }
}

export class DynamoCheckpoints implements ICheckpoints {
  constructor(
    private readonly resolve: (
      partitionId: AppendsPartitionId,
      groupName: string,
    ) => Decider<Events.Event, Fold.State>,
    private readonly checkpointFreqS: number,
  ) {}
  commit(groupName: string, tranche: string, position: bigint): Promise<void> {
    const decider = this.resolve(AppendsPartitionId.parse(tranche), groupName)
    return decider.transact(Decide.update(new Date(), position), LoadOption.AnyCachedValue)
  }
  load(
    groupName: string,
    tranche: string,
    establishOrigin?: (tranche: string) => Promise<bigint>,
  ): Promise<bigint> {
    const decider = this.resolve(AppendsPartitionId.parse(tranche), groupName)
    const now = new Date()
    return decider.transactResultAsync(
      Decide.start(
        () => establishOrigin?.(tranche) ?? Promise.resolve(0n),
        now,
        this.checkpointFreqS,
      ),
      LoadOption.AnyCachedValue,
    )
  }

  override(groupName: string, tranche: string, position: bigint): Promise<void> {
    const decider = this.resolve(AppendsPartitionId.parse(tranche), groupName)
    return decider.transact(Decide.override(new Date(), this.checkpointFreqS, position))
  }

  // prettier-ignore
  static create(context: DynamoStoreContext, cache: ICache, checkpointFreqS: number): DynamoCheckpoints {
    const access = AccessStrategy.Custom(Fold.isOrigin, Fold.transmute)
    const caching = CachingStrategy.Cache(cache)
    const category = DynamoStoreCategory.create(context, Stream.category, Events.codec, Fold.fold, Fold.initial, caching, access)
    const resolve = (partition: AppendsPartitionId, groupName: string) =>
      Decider.forStream(category, Stream.streamId(partition, groupName), null)
    return new DynamoCheckpoints(resolve, checkpointFreqS)
  }
}
