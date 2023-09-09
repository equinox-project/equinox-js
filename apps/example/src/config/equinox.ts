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

// prettier-ignore
export namespace MessageDb {
  import AccessStrategy = MessageDB.AccessStrategy
  import MessageDbCategory = MessageDB.MessageDbCategory
  import MessageDbContext = MessageDB.MessageDbContext

  export function createCached<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, access: AccessStrategy<E, S>, { context, cache }: { context: MessageDbContext; cache: ICache }) {
    const caching = CachingStrategy.Cache(cache)
    return MessageDbCategory.create(context, name, codec, fold, initial, caching, access);
  }

  export function createUnoptimized<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: { context: MessageDbContext; cache: ICache }) {
    const access = AccessStrategy.Unoptimized<E, S>()
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  }

  export function createSnapshotted<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, eventName: string, toSnapshot: (s: S) => E, config: { context: MessageDbContext; cache: ICache }) {
    const access = AccessStrategy.AdjacentSnapshots(eventName, toSnapshot)
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  }

  export function createLatestKnown<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: { context: MessageDbContext; cache: ICache }) {
    const access = AccessStrategy.LatestKnownEvent<E, S>()
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  }
}

// prettier-ignore
export namespace Dynamo {
  import AccessStrategy = DynamoDB.AccessStrategy
  import Category = DynamoDB.DynamoStoreCategory
  import Context = DynamoDB.DynamoStoreContext
  type Config = { context: Context; cache: ICache }
  export function createCached<E, S, C>(name: string, codec_: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, access: AccessStrategy<E, S>, { context, cache }: Config) {
    const caching = CachingStrategy.Cache(cache)
    const codec = Codec.deflate(codec_)
    return Category.create(context, name, codec, fold, initial, caching, access);
  }

  export function createUnoptimized<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: Config) {
    const access = AccessStrategy.Unoptimized()
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }

  export function createLatestKnown<E,S,C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: Config) {
    const access = AccessStrategy.LatestKnownEvent()
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
  export function createSnapshotted<E,S,C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, isOrigin: (e: E) => boolean, toSnapshot: (s: S) => E, config: Config) {
    const access = AccessStrategy.Snapshot(isOrigin, toSnapshot)
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
  export function createRollingState<E,S,C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, toSnapshot: (s: S) => E, config: Config) {
    const access = AccessStrategy.RollingState(toSnapshot)
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
}

// prettier-ignore
export namespace MemoryStore {
  export function create<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, { context: store }: { context: VolatileStore<string> }) {
    return MemoryStoreCategory.create(store, name, codec, fold, initial)
  }
}
