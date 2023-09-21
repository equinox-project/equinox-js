import "./tracing.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import { Payer } from "../domain/index.js"
<<<<<<< Updated upstream
import * as PayerReadModel from '../read-models/PayerReadModel.js'
=======
import * as PayerReadModel from "../read-models/PayerReadModel.js"
import { createPool, endPools } from "./config.js"
>>>>>>> Stashed changes

const messageDbPool = createPool(process.env.MDB_RO_CONN_STR || process.env.MDB_CONN_STR, 1)!
const pool = createPool(process.env.CP_CONN_STR, 50)!
const checkpoints = new PgCheckpoints(pool)

const source = MessageDbSource.create({
  pool: messageDbPool, 
  batchSize: 500,
  categories: [Payer.Stream.category],
  groupName: "PayerReadModel",
  checkpoints,
  handler: PayerReadModel.createHandler(pool),
  tailSleepIntervalMs: 100,
<<<<<<< Updated upstream
  maxConcurrentStreams: 10,
=======
  maxReadAhead: 10,
  maxConcurrentStreams: 50,
>>>>>>> Stashed changes
})

const ctrl = new AbortController()

<<<<<<< Updated upstream
process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())
=======
  await checkpoints.ensureTable()

  process.on("SIGINT", () => ctrl.abort())
  process.on("SIGTERM", () => ctrl.abort())
>>>>>>> Stashed changes

source.start(ctrl.signal)
