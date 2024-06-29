let hono = Hono.make()

let pools = []
let endPools = () => {
  let promises = []
  let rec aux = i => {
    if i < pools->Js.Array2.length {
      let pool = pools[i]
      promises->Js.Array2.push(pool->Postgres.end)->ignore
      aux(i + 1)
    }
  }
  aux(0)
  Js.Promise.then_(_ => Js.Promise.resolve(), Js.Promise.all(promises))
}

let createPool = (connectionString, max) => {
  let pool = Postgres.make({connectionString, max})
  pools->Js.Array2.push(pool)->ignore
  pool
}

@scope("process") @val
external env: Js.Dict.t<string> = "env"
let getEnv = key => env->Js.Dict.unsafeGet(key)
let getEnvSafe = key => env->Js.Dict.get(key)

let leaderPool = createPool(getEnv("MDB_CONN_STR"), 10)
let followerPool = switch getEnvSafe("MDB_RO_CONN_STR") {
| None => None
| Some(connStr) => Some(createPool(connStr, 10))
}

let cache = Equinox.Cache.createMemory()
let context = Equinox.MessageDb.Context.create({
  leaderPool,
  followerPool,
  batchSize: 500,
})
let config = (context, cache)

let payerService = Payer.Config.create(config)
let invoiceService = Invoice.Config.create(config)

hono->Hono.get("/payer/:id", async ctx => {
  let params = ctx->Hono.Context.req->Hono.Request.params
  let id = params->Js.Dict.get("id")->Belt.Option.map(Identifiers.PayerId.parse)->Belt.Option.getExn
  let payer = await payerService->Payer.Service.readProfile(id)
  ctx->Hono.Context.json(payer)
})

hono->Hono.put("/payer/:id", async ctx => {
  let body = await ctx->Hono.Context.req->Hono.Request.json
  let body = Payer.Event.payer_profile_decode(body)->Belt.Result.getExn
  let params = ctx->Hono.Context.req->Hono.Request.params
  let id = params->Js.Dict.get("id")->Belt.Option.map(Identifiers.PayerId.parse)->Belt.Option.getExn
  await payerService->Payer.Service.updateProfile(id, body)
  ctx->Hono.Context.json(Js.Json.Null)
})

hono->Hono.delete("/payer/:id", async ctx => {
  let params = ctx->Hono.Context.req->Hono.Request.params
  let id = params->Js.Dict.get("id")->Belt.Option.map(Identifiers.PayerId.parse)->Belt.Option.getExn
  await payerService->Payer.Service.deletePayer(id)
  ctx->Hono.Context.json(Js.Json.Null)
})

hono->Hono.post("/invoice", async ctx => {
  let id = Identifiers.InvoiceId.create()
  let body = await ctx->Hono.Context.req->Hono.Request.json
  await invoiceService->Invoice.Service.raise(id, body)
  ctx->Hono.Context.json({"id": id})
})

hono->Hono.get("/invoice/:id", async ctx => {
  let params = ctx->Hono.Context.req->Hono.Request.params
  let id =
    params->Js.Dict.get("id")->Belt.Option.map(Identifiers.InvoiceId.parse)->Belt.Option.getExn
  let invoice = await invoiceService->Invoice.Service.readInvoice(id)
  switch invoice {
  | None =>
    ctx->Hono.Context.status(404)
    ctx->Hono.Context.json("Not found")
  | Some(invoice) => ctx->Hono.Context.json(invoice)
  }
})

Hono.serve({port: 3000, fetch: Hono.fetch(hono)})
