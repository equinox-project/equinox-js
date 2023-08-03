import "./tracing.js"
import "express-async-errors"
import express from "express"
import pg from "pg"
import { MessageDbContext } from "@equinox-js/message-db"
import { Config, Store } from "../config/equinox.js"
import { MemoryCache } from "@equinox-js/core"
import { Payer, Invoice } from "../domain/index.js"
import { InvoiceId, PayerId } from "../domain/identifiers.js"

const createPool = (connectionString?: string) =>
  connectionString ? new pg.Pool({ connectionString, max: 10 }) : undefined

const pool = createPool(process.env.MDB_CONN_STR)!
const followerPool = createPool(process.env.MDB_RO_CONN_STR)

const context = MessageDbContext.create({ pool, followerPool, batchSize: 500 })
const config: Config = { store: Store.MessageDb, context, cache: new MemoryCache() }

const payerService = Payer.Service.create(config)
const invoiceService = Invoice.Service.create(config)

const app = express()
app.use(express.json())

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
