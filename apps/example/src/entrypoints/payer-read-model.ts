import "./tracing.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import pg from "pg"
import { Payer } from "../domain/index.js"
import * as PayerReadModel from '../read-models/PayerReadModel.js'

const createPool = (connectionString?: string) =>
  connectionString ? new pg.Pool({ connectionString, max: 10 }) : undefined

const messageDbPool = createPool(process.env.MDB_RO_CONN_STR || process.env.MDB_CONN_STR)!
const pool = createPool(process.env.CP_CONN_STR)!
const checkpointer = new PgCheckpoints(pool)
checkpointer.ensureTable().then(() => console.log("table created"))

const source = MessageDbSource.create({
  pool: messageDbPool, 
  batchSize: 500,
  categories: [Payer.Stream.CATEGORY],
  groupName: "PayerReadModel",
  checkpointer,
  handler: PayerReadModel.createHandler(pool),
  tailSleepIntervalMs: 100,
  maxConcurrentStreams: 10,
})

const ctrl = new AbortController()

process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

source.start(ctrl.signal)
