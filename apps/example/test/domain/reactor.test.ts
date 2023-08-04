import { VolatileStore } from "@equinox-js/memory-store"
import { describe, test, expect } from "vitest"
import { Config, Store } from "../../src/config/equinox.js"
import { InvoiceId, PayerId } from "../../src/domain/identifiers.js"
import { Invoice, InvoiceAutoEmailer, Payer } from "../../src/domain/index.js"

describe("reactor", () => {
  const store = new VolatileStore<string>()
  const config: Config = { store: Store.Memory, context: store }
  test("Should send an email in response to an invoice being raised", async () => {
    const invoice = Invoice.Service.create(config)
    const payer = Payer.Service.create(config)
    const handler = InvoiceAutoEmailer.createHandler(config)
    const service = InvoiceAutoEmailer.Service.create(config)

    const payerId = PayerId.create()
    const invoiceId = InvoiceId.create()

    await payer.updateProfile(payerId, { email: "test@example.com", name: "Test User" })
    await invoice.raise(invoiceId, { payer_id: payerId, amount: 100, due_date: new Date('2021-01-01T12:00:00Z')})
    await store.handleFrom(0n, handler)

    expect(await service.inspectState(invoiceId)).toMatchObject({
      type: "EmailSent",
    })
  })
})
