import { VolatileStore } from "@equinox-js/memory-store"
import { describe, test, expect } from "vitest"
import { Config, Store } from "../../src/config/equinox.js"
import { InvoiceId, PayerId } from "../../src/domain/identifiers.js"
import { InvoiceAutoEmailer, Payer } from "../../src/domain/index.js"

describe("Invoice auto emailer", () => {
  const store = new VolatileStore<string>()
  const config: Config = { store: Store.Memory, context: store }

  const profile = { name: "Test", email: "test@example.com" }

  test("It does not send emails if it can't find the payer", async () => {
    const invoiceId = InvoiceId.create()
    const payerId = PayerId.create()
    const emailer = InvoiceAutoEmailer.Service.create(config)
    await emailer.sendEmail({}, invoiceId, payerId, 100)
    expect(await emailer.inspectState(invoiceId)).toEqual({
      type: "EmailSendingFailed",
      data: { payer_id: payerId, reason: "Payer not found" },
    })
  })

  test("It sends emails", async () => {
    const invoiceId = InvoiceId.create()
    const payerId = PayerId.create()
    const payers = Payer.Service.create(config)
    const emailer = InvoiceAutoEmailer.Service.create(config)
    await payers.updateProfile(payerId, profile)
    await emailer.sendEmail({}, invoiceId, payerId, 100)
    expect(await emailer.inspectState(invoiceId)).toEqual({
      type: "EmailSent",
      data: { email: profile.email, payer_id: payerId },
    })
  })

  test("records failures to send emails as events", async () => {
    const invoiceId = InvoiceId.create()
    const payerId = PayerId.create()
    const payers = Payer.Service.create(config)
    const emailer = InvoiceAutoEmailer.Service.create(config, {
      sendEmail: () => Promise.reject(new Error("Test failure")),
    })
    await payers.updateProfile(payerId, profile)
    await emailer.sendEmail({}, invoiceId, payerId, 100)
    expect(await emailer.inspectState(invoiceId)).toEqual({
      type: "EmailSendingFailed",
      data: { payer_id: payerId, reason: "Test failure" },
    })
  })
})
