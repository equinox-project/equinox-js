import { describe, test, expect } from "vitest"
import { Fold, Decide, Events } from "../../src/domain/invoice.js"
import { createTester, expectError, expectEventsMatching } from "./scenario.js"

const { scenario } = createTester(Fold)

const raised = Events.Event.InvoiceRaised.example() 

describe("Codec", () => {
  test("roundtrips", () => {
    for (let i = 0; i < 100; i++) {
      const event = Events.Event.example()
      console.log(event)
      const encoded = Events.codec.encode(event, null)
      console.log(encoded)
      const decoded = Events.codec.tryDecode(encoded as any)
      expect(decoded).toEqual(event)
    }
  })
})

const paymentReceived = Events.Event.PaymentReceived.example()
describe("Invoice", () => {
  scenario("Raising an invoice")
    .given([])
    .when(Decide.raiseInvoice(raised.data))
    .then(expectEventsMatching([raised]))

  scenario("Raising an invoice twice")
    .given([raised])
    .when(Decide.raiseInvoice(raised.data))
    .then(expectEventsMatching([]))

  scenario("Raising an invoice after it has been finalized")
    .given([raised, { type: "InvoiceFinalized" }])
    .when(Decide.raiseInvoice(raised.data))
    .then(expectError)

  scenario("Recordong a payment on a non-existent invoice")
    .given([])
    .when(Decide.recordPayment(paymentReceived.data))
    .then(expectError)

  scenario("Recording a payment on an invoice")
    .given([raised])
    .when(Decide.recordPayment(paymentReceived.data))
    .then(expectEventsMatching([paymentReceived]))

  scenario("Recording a payment on an invoice twice")
    .given([raised, paymentReceived])
    .when(Decide.recordPayment(paymentReceived.data))
    .then(expectEventsMatching([]))
})
