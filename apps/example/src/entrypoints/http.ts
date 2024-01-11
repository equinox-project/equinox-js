import "express-async-errors"
import express from "express"
import { Payer, Invoice } from "../domain/index.js"
import { InvoiceId, PayerId } from "../domain/identifiers.js"
import { createConfig, leaderPool } from "./config.js"
import * as PayerReadModel from "../read-models/PayerReadModel.js"

const config = createConfig()

const payerService = Payer.Service.create(config)
const payerReadModel = PayerReadModel.create(leaderPool())
const invoiceService = Invoice.Service.create(config)

const app = express()
app.use(express.json())

app.get('/payers', async (req, res) => {
  const payers = await payerReadModel.readAll()
  res.status(200).json(payers)
})

app.get("/payer/:id", async (req, res) => {
  const profile = await payerService.readProfile(PayerId.parse(req.params.id))
  if (!profile) return res.status(404).json(null)
  return res.status(200).json(profile)
})

app.put("/payer/:id", async (req, res) => {
  const body = Payer.Events.PayerProfile.parse(req.body)
  await payerService.updateProfile(PayerId.parse(req.params.id), body)
  res.status(200).json(body)
})

app.delete("/payer/:id", async (req, res) => {
  await payerService.deletePayer(PayerId.parse(req.params.id))
  res.status(200).json(null)
})

app.post("/invoice", async (req, res) => {
  const id = InvoiceId.create()
  const body = Invoice.Events.InvoiceRaised.parse(req.body)
  await invoiceService.raise(id, body)
  res.status(200).json({ id })
})

app.get("/invoice/:id", async (req, res) => {
  const invoice = await invoiceService.readInvoice(InvoiceId.parse(req.params.id))
  if (!invoice) return res.status(404).json(null)
  return res.status(200).json(invoice)
})

app.listen(3000, () => console.log(`App listening on port 3000`))
