import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import { Payer } from "../domain/index.js"
import * as PayerReadModel from "../read-models/PayerReadModel.js"
import { createPool, endPools } from "./config.js"

const messageDbPool = createPool(process.env.MDB_RO_CONN_STR || process.env.MDB_CONN_STR, 1)!
const pool = createPool(process.env.CP_CONN_STR, 50)!
const checkpoints = new PgCheckpoints(pool)

const handler = PayerReadModel.createHandler(pool)

const source = MessageDbSource.create({
  pool: messageDbPool,
  batchSize: 500,
  categories: [Payer.Stream.category],
  groupName: "PayerReadModel",
  checkpoints,
  handler,
  tailSleepIntervalMs: 100,
  maxReadAhead: 10,
  maxConcurrentStreams: 10,
})

async function main() {
  const ctrl = new AbortController()
  await checkpoints.ensureTable()

  process.on("SIGINT", () => ctrl.abort())
  process.on("SIGTERM", () => ctrl.abort())

  await source.start(ctrl.signal)
  await endPools()
}

main()
