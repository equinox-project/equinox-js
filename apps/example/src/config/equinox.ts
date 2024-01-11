import { ICodec, ICache, CachingStrategy, Codec } from "@equinox-js/core"
import { MemoryStoreCategory, VolatileStore } from "@equinox-js/memory-store"
import * as MessageDB from "@equinox-js/message-db"
import * as DynamoDB from "@equinox-js/dynamo-store"

export enum Store {
  Memory,
  MessageDb,
  Dynamo,
}

export type Config =
  | { store: Store.Memory; context: VolatileStore<string> }
  | { store: Store.MessageDb; context: MessageDB.MessageDbContext; cache: ICache }
  | { store: Store.Dynamo; context: DynamoDB.DynamoStoreContext; cache: ICache }

type Fold<E, S> = {
  fold: (s: S, e: E[]) => S
  initial: S
}

type Events<E, C> = {
  codec: ICodec<E, string, C>
}

// prettier-ignore
export namespace MessageDb {
  import AccessStrategy = MessageDB.AccessStrategy
  import MessageDbCategory = MessageDB.MessageDbCategory
  import MessageDbContext = MessageDB.MessageDbContext
  type Project<S> = MessageDB.OnSync<S>
  type Config = { context: MessageDbContext; cache: ICache }

  type SnapshottedFold<E, S> = Fold<E, S> & {
    toSnapshot: (s: S) => E
    eventName: string
  }

  export function createCached<E, S, C>(name: string, events: Events<E, C>, fold: Fold<E,S>, access: AccessStrategy<E, S>, { context, cache }: Config, project?: Project<S>) {
    const caching = CachingStrategy.Cache(cache)
    return MessageDbCategory.create(context, name, events.codec, fold.fold, fold.initial, caching, access, project);
  }

  export function createUnoptimized<E, S, C>(name: string, events: Events<E, C>, fold: Fold<E,S>, config: Config, project?: Project<S>) {
    const access = AccessStrategy.Unoptimized<E, S>()
    return MessageDb.createCached(name, events, fold, access, config, project)
  }

  export function createSnapshotted<E, S, C>(name: string, events: Events<E,C>, fold: SnapshottedFold<E,S>, config: Config, project?: Project<S>) {
    const access = AccessStrategy.AdjacentSnapshots(fold.eventName, fold.toSnapshot)
    return MessageDb.createCached(name, events, fold, access, config, project)
  }

  export function createLatestKnown<E, S, C>(name: string, events: Events<E, C>, fold: Fold<E,S>, config: Config, project?: Project<S>) {
    const access = AccessStrategy.LatestKnownEvent<E, S>()
    return MessageDb.createCached(name, events, fold, access, config, project)
  }
}

// prettier-ignore
export namespace Dynamo {
  import AccessStrategy = DynamoDB.AccessStrategy
  import Category = DynamoDB.DynamoStoreCategory
  import Context = DynamoDB.DynamoStoreContext
  type Config = { context: Context; cache: ICache }
type RollingStateFold<E, S> = Fold<E, S> & {
    toSnapshot: (s: S) => E
  }
  type SnapshottedFold<E, S> = RollingStateFold<E, S> & {
    isOrigin: (e: E) => boolean
  }
  export function createCached<E, S, C>(name: string, events: Events<E, C>, fold: Fold<E,S>, access: AccessStrategy<E, S>, { context, cache }: Config) {
    const caching = CachingStrategy.Cache(cache)
    const codec = Codec.compress(events.codec)
    return Category.create(context, name, codec, fold.fold, fold.initial, caching, access);
  }

  export function createUnoptimized<E, S, C>(name: string, events: Events<E, C>, fold: Fold<E,S>, config: Config) {
    const access = AccessStrategy.Unoptimized()
    return Dynamo.createCached(name, events, fold, access, config)
  }

  export function createLatestKnown<E, S, C>(name: string, events: Events<E, C>, fold: Fold<E,S>, config: Config) {
    const access = AccessStrategy.LatestKnownEvent()
    return Dynamo.createCached(name, events, fold, access, config)
  }
  export function createSnapshotted<E, S, C>(name: string, events: Events<E, C>, fold: SnapshottedFold<E,S>, config: Config) {
    const access = AccessStrategy.Snapshot(fold.isOrigin, fold.toSnapshot)
    return Dynamo.createCached(name, events, fold, access, config)
  }
  export function createRollingState<E, S, C>(name: string, events: Events<E, C>, fold: RollingStateFold<E,S>, config: Config) {
    const access = AccessStrategy.RollingState(fold.toSnapshot)
    return Dynamo.createCached(name, events, fold, access, config)
  }
}

// prettier-ignore
export namespace MemoryStore {
  export function create<E, S, C>(name: string, events: Events<E,C>, fold: Fold<E,S>, { context: store }: { context: VolatileStore<string> }) {
    return MemoryStoreCategory.create(store, name, events.codec, fold.fold, fold.initial)
  }
}
