import "./tracing.js"
import pg from "pg"
import { MessageDbContext } from "@equinox-js/message-db"
import { Config, Store } from "../config/equinox.js"
import { ITimelineEvent, MemoryCache } from "@equinox-js/core"
import { Invoice, InvoiceAutoEmailer } from "../domain/index.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"

const createPool = (connectionString?: string) =>
  connectionString ? new pg.Pool({ connectionString, max: 10 }) : undefined

const pool = createPool(process.env.MDB_CONN_STR)!
const followerPool = createPool(process.env.MDB_RO_CONN_STR)

const context = MessageDbContext.create({ pool, followerPool, batchSize: 500 })
const config: Config = { store: Store.MessageDb, context, cache: new MemoryCache() }

const invoiceEmailer = InvoiceAutoEmailer.Service.create(config)

const checkpointer = new PgCheckpoints(createPool(process.env.CP_CONN_STR)!)
checkpointer.ensureTable().then(() => console.log("table created"))

function impliesInvoiceEmailRequired(streamName: string, events: ITimelineEvent[]) {
  const id = Invoice.Stream.tryMatch(streamName)
  if (!id) return
  const ev = Invoice.Events.codec.tryDecode(events[0])
  if (ev?.type !== "InvoiceRaised") return
  return { id, payer_id: ev.data.payer_id, amount: ev.data.amount }
}

async function handle(streamName: string, events: ITimelineEvent[]) {
  const req = impliesInvoiceEmailRequired(streamName, events)
  if (!req) return
  await invoiceEmailer.sendEmail(req.id, req.payer_id, req.amount)
}

const source = MessageDbSource.create({
  pool: followerPool ?? pool,
  batchSize: 500,
  categories: [Invoice.Stream.CATEGORY],
  groupName: "InvoiceAutoEmailer",
  checkpointer,
  handler: handle,
  tailSleepIntervalMs: 100,
  maxConcurrentStreams: 10,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

source.start(ctrl.signal)
