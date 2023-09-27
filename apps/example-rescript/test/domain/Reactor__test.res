open Vitest
open Identifiers
open Equinox

describe("Reactor", () => {
  let store = MemoryStore.create()
  let config = EquinoxConfig.MemoryStore(store)
  testAsync("Should send an email in response to an invoice being raised", async () => {
    let invoice = Invoice.Config.create(config)
    let payer = Payer.Config.create(config)
    let handler = InvoiceAutoEmailer.Config.createHandler(config, None)
    let service = InvoiceAutoEmailer.Config.create(config, None)

    let payerId = PayerId.create()
    let invoiceId = InvoiceId.create()

    await payer->Payer.Service.updateProfile(
      payerId,
      {email: "test@example.com", name: "Test User"},
    )
    await invoice->Invoice.Service.raise(
      invoiceId,
      {payer_id: payerId, amount: 100., due_date: Js.Date.fromString("2021-01-01T12:00:00Z")},
    )
    await store->MemoryStore.handleFrom(%raw("0n"), handler)

    let state = await service->InvoiceAutoEmailer.Service.inspectState(invoiceId)

    state->Expect.toEqual(
      InvoiceAutoEmailer.Event.EmailSent({
        email: "test@example.com",
        payer_id: payerId,
      }),
    )
  })
})
