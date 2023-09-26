let pools = []
let endPools = () => {
  let promises = []
  let rec aux = i => {
    if i < pools->Js.Array2.length {
      let pool = pools[i]
      promises->Js.Array2.push(pool->Postgres.Pool.end)->ignore
      aux(i + 1)
    }
  }
  aux(0)
  Js.Promise.all(promises) |> Js.Promise.then_(_ => Js.Promise.resolve())
}

let createPool = (connectionString, max) => {
  let pool = Postgres.Pool.make({connectionString, max})
  pools->Js.Array2.push(pool)->ignore
  pool
}

@scope("process") @val
external env: Js.Dict.t<string> = "env"
let getEnv = key => env->Js.Dict.unsafeGet(key)
let getEnvSafe = key => env->Js.Dict.get(key)

let leaderPool = lazy createPool(getEnv("MDB_CONN_STR"), 10)
let followerPool = switch getEnvSafe("MDB_RO_CONN_STR") {
| None => lazy None
| Some(connStr) => lazy Some(createPool(connStr, 10))
}

let createMessageDbConfig = () => {
  let lazy leaderPool = leaderPool
  let lazy followerPool = followerPool
  let cache = Equinox.Cache.createMemory()
  EquinoxConfig.MessageDb(
    Equinox.MessageDbContext.create({
      leaderPool,
      followerPool,
      batchSize: 500,
    }),
    cache,
  )
}

let createMemoryConfig = () => {
  let store = Equinox.MemoryStore.create()
  EquinoxConfig.MemoryStore(store)
}

let createConfig = () => {
  switch getEnv("STORE") {
  | "message-db" => createMessageDbConfig()
  | "memory" => createMemoryConfig()
  | store => failwith("Unknown store: " ++ store)
  }
}
