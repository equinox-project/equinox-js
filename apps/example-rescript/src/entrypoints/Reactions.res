open Equinox

let config = Config.createConfig()
let invoiceEmailer = InvoiceAutoEmailer.Config.create(config, None)

let impliesInvoiceEmailRequired = (sn, events) => 
  switch Invoice.Stream.tryMatch(sn) {
    | Some(id) => 
      switch Invoice.Event.codec.tryDecode(events[0]) {
        | Some(Invoice.Event.InvoiceRaised(ev)) => Some(id, ev)
        | _ => None
      }
    | _ => None
}

let handler = (sn, events) => switch impliesInvoiceEmailRequired(sn,events) {
  | Some(id, data) => invoiceEmailer->InvoiceAutoEmailer.Service.sendEmail(id, data.payer_id, data.amount)
  | None => Js.Promise2.resolve()
}

let sink = StreamsSink.create({ handler, maxConcurrentStreams: 10, maxReadAhead: 3 })
let createSource = async () => {
  switch config {
    | MessageDb(_) => 
      let checkpoints = Checkpoints.createPg(Config.createPool(Config.getEnv("CP_CONN_STR"), 1))
      await checkpoints->Checkpoints.ensureTable
      MessageDbSource.create({
        pool: switch (Config.followerPool) {
          | lazy Some(pool) => pool
          | lazy None => Lazy.force(Config.leaderPool)
        },
        batchSize: 1000,
        categories: [Invoice.Stream.category],
        groupName: "InvoiceAutoEmailer",
        checkpoints,
        sink,
        tailSleepIntervalMs: 1000,
        statsIntervalMs: 10000,
      })
    | MemoryStore(_) => Js.Exn.raiseError("Memory store not supported")
    }
  }

let main = async () => {
  let source = await createSource()
  let ctrl = AbortController.make()
  Process.process
  ->Process.onSigint(() => ctrl->AbortController.abort)
  ->Process.onSigterm(() => ctrl->AbortController.abort)
  ->ignore

  await source->MessageDbSource.start(ctrl.signal)
  await Config.endPools()
}

main()->ignore
