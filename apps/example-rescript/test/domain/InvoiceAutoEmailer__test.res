open Identifiers
open Equinox
open Vitest

describe("Invoice auto emailer", () => {
  let store = MemoryStore.create()
  let config = EquinoxConfig.MemoryStore(store)

  let profile = {Payer.Event.name: "Test", email: "test@example.com"}

  testAsync("It does not send emails if it can't find the payer", async () => {
    open InvoiceAutoEmailer
    let invoiceId = InvoiceId.create()
    let payerId = PayerId.create()
    let emailer = Config.create(config, None)
    await emailer->Service.sendEmail(invoiceId, payerId, 100.)
    let state = await emailer->Service.inspectState(invoiceId)
    state->Expect.toEqual(
      Event.EmailSendingFailed({
        payer_id: payerId,
        reason: "Payer not found",
      }),
    )
  })

  testAsync("It sends emails", async () => {
    let invoiceId = InvoiceId.create()
    let payerId = PayerId.create()
    let payers = Payer.Config.create(config)
    let emailer = InvoiceAutoEmailer.Config.create(config, None)
    await payers->Payer.Service.updateProfile(payerId, profile)
    await emailer->InvoiceAutoEmailer.Service.sendEmail(invoiceId, payerId, 100.)
    let state = await emailer->InvoiceAutoEmailer.Service.inspectState(invoiceId)
    state->Expect.toEqual(
      InvoiceAutoEmailer.Event.EmailSent({
        email: profile.email,
        payer_id: payerId,
      }),
    )
  })
  testAsync("records failures to send emails as events", async () => {
    let invoiceId = InvoiceId.create()
    let payerId = PayerId.create()
    let payers = Payer.Config.create(config)
    let emailer = InvoiceAutoEmailer.Config.create(
      config,
      Some((_,_,_) => Js.Promise.reject(%raw(`new Error("Test failure")`)))
    )
    await payers->Payer.Service.updateProfile(payerId, profile)
    await emailer->InvoiceAutoEmailer.Service.sendEmail(invoiceId, payerId, 100.)
    let state = await emailer->InvoiceAutoEmailer.Service.inspectState(invoiceId)
    state->Expect.toEqual(
      InvoiceAutoEmailer.Event.EmailSendingFailed({
        payer_id: payerId,
        reason: "Test failure",
      }),
    )
  })
})

