type store<'a> =
  | MessageDb(Equinox.MessageDbContext.t, Equinox.Cache.t)
  | MemoryStore(Equinox.MemoryStore.volatile_store)

module MessageDb = {
  let createCached = (name, codec, fold, initial, access, (ctx, cache)) => {
    let caching = Equinox.CachingStrategy.cached(cache)
    Equinox.MessageDbCategory.create(ctx, name, codec, fold, initial, caching, access)
  }

  let createUnoptimized = (name, codec, fold, initial, conf) => {
    let access = Equinox.MessageDbAccessStrategy.unoptimized()
    createCached(name, codec, fold, initial, access, conf)
  }

  let createSnapshotted = (name, codec, fold, initial, (eventName, toSnapshot), conf) => {
    let access = Equinox.MessageDbAccessStrategy.adjacentSnapshots(eventName, toSnapshot)
    createCached(name, codec, fold, initial, access, conf)
  }

  let createLatestKnown = (name, codec, fold, initial, conf) => {
    let access = Equinox.MessageDbAccessStrategy.latestKnownEvent()
    createCached(name, codec, fold, initial, access, conf)
  }
}

module MemoryStore = {
  let create = (name, codec, fold, initial, store) => {
    Equinox.MemoryStoreCategory.create(store, name, codec, fold, initial)
  }
}
