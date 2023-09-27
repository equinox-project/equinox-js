open Equinox
let config = Config.createConfig()

let messageDbPool = Config.createPool(Config.getEnv("MDB_RO_CONN_STR"), 1)
let pool = Config.createPool(Config.getEnv("CP_CONN_STR"), 50)
let checkpoints = Checkpoints.createPg(pool)

let handler = PayerReadModel.createHandler(pool)

let sink = StreamsSink.create({
  handler,
  maxConcurrentStreams: 10,
  maxReadAhead: 3,
})

let source = MessageDbSource.create({
  pool: messageDbPool,
  batchSize: 500,
  categories: [Payer.Stream.category],
  groupName: "PayerReadModel",
  checkpoints,
  sink,
  tailSleepIntervalMs: 1000,
})

let main = async () => {
  let ctrl = AbortController.make()
  Js.log("Creating checkpoints")
  await checkpoints->Checkpoints.ensureTable
  Js.log("Creating payer table")
  (await pool->PayerReadModel.ensureTable)->ignore

  Process.process
  ->Process.onSigint(() => ctrl->AbortController.abort)
  ->Process.onSigterm(() => ctrl->AbortController.abort)
  ->ignore

  Js.log("Starting source")
  await source->MessageDbSource.start(ctrl.signal)
  await Config.endPools()
}

main()->Js.Promise2.catch(x => Js.Promise2.resolve(Js.log(x)))->ignore
