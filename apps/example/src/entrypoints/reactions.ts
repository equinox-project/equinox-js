import "./tracing.js"
import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Invoice, InvoiceAutoEmailer } from "../domain/index.js"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import { DynamoStoreSource, DynamoCheckpoints, LoadMode } from "@equinox-js/dynamo-store-source"
import { createConfig, createPool, dynamoDB, endPools, followerPool, leaderPool } from "./config.js"
import { Store } from "../config/equinox.js"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"

const config = createConfig()

const invoiceEmailer = InvoiceAutoEmailer.Service.create(config)

function impliesInvoiceEmailRequired(streamName: StreamName, events: ITimelineEvent[]) {
  const id = Invoice.Stream.tryMatch(streamName)
  if (!id) return
  const ev = Invoice.Events.codec.tryDecode(events[0])
  if (ev?.type !== "InvoiceRaised") return
  return { id, payer_id: ev.data.payer_id, amount: ev.data.amount }
}
async function handle(streamName: StreamName, events: ITimelineEvent[]) {
  const req = impliesInvoiceEmailRequired(streamName, events)
  if (!req) return
  await invoiceEmailer.sendEmail(req.id, req.payer_id, req.amount)
}

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
        handler: handle,
        tailSleepIntervalMs: 100,
        maxConcurrentStreams: 10,
        maxReadAhead: 10,
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
        handler: handle,
        tailSleepIntervalMs: 100,
        maxConcurrentStreams: 10,
        maxReadAhead: 10,
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
