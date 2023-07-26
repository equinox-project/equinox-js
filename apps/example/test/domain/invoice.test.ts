import { describe, test, expect } from "vitest"
import * as Invoice from "../../src/domain/invoice.js"
import { PayerId } from "../../src/domain/identifiers.js"
import { createBDD, expectError, expectEventsMatching } from "./scenario.js"

const { scenario } = createBDD(Invoice.fold, Invoice.initial)

const raised = {
  type: "InvoiceRaised",
  data: {
    payer_id: PayerId.create(),
    amount: 100,
  },
} as const

describe("Codec", () => {
  test("roundtrips", () => {
    const encoded = Invoice.codec.encode(raised, null)
    const decoded = Invoice.codec.tryDecode(encoded as any)
    expect(decoded).toEqual(raised)
  })
})

const paymentReceived: Invoice.Event = {
  type: "PaymentReceived",
  data: { amount: 10, reference: "123" },
}

describe("Invoice", () => {
  scenario("Raising an invoice")
    .given([])
    .when(Invoice.raiseInvoice(raised.data))
    .then(expectEventsMatching([raised]))

  scenario("Raising an invoice twice")
    .given([raised])
    .when(Invoice.raiseInvoice(raised.data))
    .then(expectEventsMatching([]))

  scenario("Raising an invoice after it has been finalized")
    .given([raised, { type: "InvoiceFinalized" }])
    .when(Invoice.raiseInvoice(raised.data))
    .then(expectError)

  scenario("Recordong a payment on a non-existent invoice")
    .given([])
    .when(Invoice.recordPayment(paymentReceived.data))
    .then(expectError)

  scenario("Recording a payment on an invoice")
    .given([raised])
    .when(Invoice.recordPayment(paymentReceived.data))
    .then(expectEventsMatching([paymentReceived]))

  scenario("Recording a payment on an invoice twice")
    .given([raised, paymentReceived])
    .when(Invoice.recordPayment(paymentReceived.data))
    .then(expectEventsMatching([]))
})

