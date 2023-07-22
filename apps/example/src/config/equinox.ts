import { ICodec, ICache, CachingStrategy } from "@equinox-js/core"
import { MemoryStoreCategory, VolatileStore } from "@equinox-js/memory-store"
import { AccessStrategy, MessageDbCategory, MessageDbContext } from "@equinox-js/message-db"

export enum Store {
  Memory,
  MessageDb,
}
export type Config =
  | { store: Store.Memory; context: VolatileStore<string> }
  | { store: Store.MessageDb; context: MessageDbContext; cache: ICache }

export const MessageDb = {
  createCached<E, S, C>(
    name: string,
    codec: ICodec<E, string, C>,
    fold: (s: S, e: E[]) => S,
    initial: S,
    access: AccessStrategy<E, S>,
    { context, cache }: { context: MessageDbContext; cache: ICache },
  ) {
    const caching = CachingStrategy.slidingWindow(cache, 12e5)
    // prettier-ignore
    return MessageDbCategory.create(context, name, codec, fold, initial, caching, access);
  },

  createUnoptimized<E, S, C>(
    name: string,
    codec: ICodec<E, string, C>,
    fold: (s: S, e: E[]) => S,
    initial: S,
    config: { context: MessageDbContext; cache: ICache },
  ) {
    const access = AccessStrategy.Unoptimized<E, S>()
    // prettier-ignore
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  },

  createSnapshotted<E, S, C>(
    name: string,
    codec: ICodec<E, string, C>,
    fold: (s: S, e: E[]) => S,
    initial: S,
    eventName: string,
    toSnapshot: (s: S) => E,
    config: { context: MessageDbContext; cache: ICache },
  ) {
    const access = AccessStrategy.AdjacentSnapshots(eventName, toSnapshot)
    // prettier-ignore
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  },

  createLatestKnown<E, S, C>(
    name: string,
    codec: ICodec<E, string, C>,
    fold: (s: S, e: E[]) => S,
    initial: S,
    config: { context: MessageDbContext; cache: ICache },
  ) {
    const access = AccessStrategy.LatestKnownEvent<E, S>()
    // prettier-ignore
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  },
}

export const MemoryStore = {
  create<E, S, C>(
    name: string,
    codec: ICodec<E, string, C>,
    fold: (s: S, e: E[]) => S,
    initial: S,
    { context: store }: { context: VolatileStore<string> },
  ) {
    // prettier-ignore
    return MemoryStoreCategory.create(store, name, codec, fold, initial)
  },
}
