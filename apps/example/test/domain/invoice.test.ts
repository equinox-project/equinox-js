import { describe, test, expect } from "vitest"
import * as Invoice from "../../src/domain/invoice.js"
import { PayerId } from "../../src/domain/identifiers.js"

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

const given = (events: Invoice.Event[], decide: (state: Invoice.State) => Invoice.Event[]) =>
  decide(Invoice.fold(Invoice.initial, events))
test("Raising an invoice", () => {
  expect(given([], Invoice.raiseInvoice(raised.data))).toEqual([raised])
  expect(given([raised], Invoice.raiseInvoice(raised.data))).toEqual([])
  expect(() =>
    given([raised, { type: "InvoiceFinalized" }], Invoice.raiseInvoice(raised.data)),
  ).toThrow()
})

const paymentReceived: Invoice.Event = {
  type: "PaymentReceived",
  data: { amount: 10, reference: "123" },
}
test("Payments", () => {
  expect(() => given([], Invoice.recordPayment(paymentReceived.data))).toThrow()
  expect(given([raised], Invoice.recordPayment(paymentReceived.data))).toEqual([paymentReceived])
  expect(given([raised, paymentReceived], Invoice.recordPayment(paymentReceived.data))).toEqual([])
})

test("Payments", () => {
  expect(() => given([], Invoice.recordPayment(paymentReceived.data))).toThrow()
  expect(given([raised], Invoice.recordPayment(paymentReceived.data))).toEqual([paymentReceived])
  expect(given([raised, paymentReceived], Invoice.recordPayment(paymentReceived.data))).toEqual([])
})
