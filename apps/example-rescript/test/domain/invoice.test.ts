import { describe, test, expect } from "vitest"
import { Fold, Decide, Events } from "../../src/domain/invoice.js"
import { PayerId } from "../../src/domain/identifiers.js"
import { createTester, expectError, expectEventsMatching } from "./scenario.js"

const { scenario } = createTester(Fold)

const raised: Events.Event = {
  type: "InvoiceRaised",
  data: {
    payer_id: PayerId.create(),
    amount: 100,
    due_date: new Date('2021-01-01T12:00:00Z'),
  },
}

describe("Codec", () => {
  test("roundtrips", () => {
    const encoded = Events.codec.encode(raised, null)
    const decoded = Events.codec.tryDecode(encoded as any)
    expect(decoded).toEqual(raised)
  })
})

const paymentReceived: Events.Event = {
  type: "PaymentReceived",
  data: { amount: 10, reference: "123" },
}

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
