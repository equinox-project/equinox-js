import "./tracing.js"
import { Invoice, InvoiceAutoEmailer } from "../domain/index.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-source"
import { DynamoStoreSource, DynamoCheckpoints, LoadMode } from "@equinox-js/dynamo-store-source"
import { createConfig, createPool, dynamoDB, endPools, followerPool, leaderPool } from "./config.js"
import { Store } from "../config/equinox.js"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"
import { StreamsSink } from "@equinox-js/propeller"

const config = createConfig()

const handler = InvoiceAutoEmailer.createHandler(config)

const sink = StreamsSink.create({ handler, maxConcurrentStreams: 10, maxReadAhead: 3 })

async function createSource() {
  switch (config.store) {
    case Store.Memory:
      throw new Error("Memory store not supported")
    case Store.MessageDb: {
      const checkpoints = new PgCheckpoints(createPool(process.env.CP_CONN_STR)!)
      await checkpoints.ensureTable().then(() => console.log("table created"))

      return MessageDbSource.create({
        pool: followerPool() ?? leaderPool(),
        batchSize: 500,
        categories: [Invoice.Stream.CATEGORY],
        groupName: "InvoiceAutoEmailer",
        checkpoints,
        sink,
        tailSleepIntervalMs: 1000,
        statsIntervalMs: 10000,
      })
    }
    case Store.Dynamo: {
      const ddb = dynamoDB()
      const context = new DynamoStoreContext({
        client: new DynamoStoreClient(ddb),
        tableName: process.env.INDEX_TABLE_NAME || "events_index",
        tip: TipOptions.create({}),
        query: QueryOptions.create({}),
      })
      const checkpoints = DynamoCheckpoints.create(
        context,
        config.cache,
        300, // 5 minutes
      )
      return DynamoStoreSource.create({
        context,
        categories: [Invoice.Stream.CATEGORY],
        groupName: "InvoiceAutoEmailer",
        checkpoints,
        sink,
        tailSleepIntervalMs: 100,
        batchSizeCutoff: 500,
        mode: LoadMode.WithData(10, config.context),
      })
    }
  }
}

async function main() {
  const source = await createSource()

  const ctrl = new AbortController()

  process.on("SIGINT", () => ctrl.abort())
  process.on("SIGTERM", () => ctrl.abort())

  await source.start(ctrl.signal)
  await endPools()
}

main()
