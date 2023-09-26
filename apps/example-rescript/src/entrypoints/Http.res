let config = Config.createConfig()

let invoiceService = Invoice.Config.create(config)

let app = Express.express()

app->Express.use(Express.jsonMiddleware())

let handle = (fn): Express.handler => {
  let () = ()
  (req, res, next) =>
    fn(req, res)->Js.Promise2.catch(err => Js.Promise.resolve(next(. Obj.magic(err))))->ignore
}

app->Express.post(
  "/invoice",
  handle(async (req, res) => {
    let id = Identifiers.InvoiceId.create()
    let body = req->Express.body
    await invoiceService->Invoice.Service.raise(id, body)
    res->Express.status(200)->Express.json({"id": id})->ignore
  }),
)

app->Express.get(
  "/invoice/:id",
  handle(async (req, res) => {
    let id = Identifiers.InvoiceId.parse(Express.params(req)["id"])
    switch await invoiceService->Invoice.Service.readInvoice(id) {
    | Some(invoice) => res->Express.status(200)->Express.json(invoice)->ignore
    | None => res->Express.status(404)->Express.json(Js.Null.empty)->ignore
    }
  }),
)

let payerService = Payer.Config.create(config)

app->Express.get(
  "/payer/:id",
  handle(async (req, res) => {
    let id = Identifiers.PayerId.parse(Express.params(req)["id"])
    switch await payerService->Payer.Service.readProfile(id) {
    | Some(profile) => res->Express.status(200)->Express.json(profile)->ignore
    | None => res->Express.status(404)->Express.json(Js.Null.empty)->ignore
    }
  }),
)

app->Express.put(
  "/payer/:id",
  handle(async (req, res) => {
    let id = Identifiers.PayerId.parse(Express.params(req)["id"])
    let body = req->Express.body
    await payerService->Payer.Service.updateProfile(id, body)
    res->Express.status(200)->Express.json(body)->ignore
  }),
)

app->Express.delete(
  "/payer/:id",
  handle(async (req, res) => {
    let id = Identifiers.PayerId.parse(Express.params(req)["id"])
    await payerService->Payer.Service.deletePayer(id)
    res->Express.status(200)->Express.json(Js.Null.empty)->ignore
  }),
)

app->Express.listenWithCallback(3000, _ => Js.log("App listening on port 3000"))->ignore
