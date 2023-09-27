open Vitest
open Invoice
open Identifiers

module Test = Scenario.Make({
  type event = Event.t
  type state = Fold.state
  let fold = Fold.fold
  let initial = Fold.initial
})

let raised = {
  Event.payer_id: PayerId.create(),
  amount: 100.,
  due_date: Js.Date.fromString("2021-01-01T12:00:00Z"),
}

let raisedEvent = Event.InvoiceRaised(raised)

describe("Codec", () => {
  test("roundtrips", () => {
    let encoded = Event.codec.encode(raisedEvent, ())
    let decoded = Event.codec.tryDecode(encoded->Obj.magic)
    decoded->Expect.toEqual(raisedEvent)
  })
})

let paymentReceived = {
  Event.amount: 10.,
  reference: "123",
}

describe("Invoice", () => {
  open Test

  scenario("Raising an invoice")
  ->given([])
  ->when_(Decide.raiseInvoice(raised))
  ->then([raisedEvent])

  scenario("Raising an invoice twice")
  ->given([raisedEvent])
  ->when_(Decide.raiseInvoice(raised))
  ->then([])

  scenario("Raising an invoice after it has been finalized")
  ->given([raisedEvent, Event.InvoiceFinalized])
  ->when_(Decide.raiseInvoice(raised))
  ->thenError

  scenario("Recording a payment on a non-existent invoice")
  ->given([])
  ->when_(Decide.recordPayment(paymentReceived))
  ->thenError

  scenario("Recording a payment on an invoice")
  ->given([raisedEvent])
  ->when_(Decide.recordPayment(paymentReceived))
  ->then([Event.PaymentReceived(paymentReceived)])

  scenario("Recording a payment on an invoice twice")
  ->given([raisedEvent, Event.PaymentReceived(paymentReceived)])
  ->when_(Decide.recordPayment(paymentReceived))
  ->then([])
})

