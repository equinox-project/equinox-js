#!/usr/bin/env node

import { Command } from "commander"
import {
  BillingMode,
  DynamoDB,
  KeyType,
  ScalarAttributeType,
  StreamViewType,
  TableClass,
} from "@aws-sdk/client-dynamodb"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  EventsContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"
import { renderObject, chalk } from "../src/render.js"
import { Codec } from "@equinox-js/core"

BigInt.prototype.toJSON = function () {
  return this.toString()
}

const program = new Command()

program.name("dynamostore-cli").version("0.0.1").description("DynamoStore CLI")

const createDynamoClient = (options) => {
  const { endpoint } = options
  const dynamoOptions = endpoint ? { endpoint } : {}
  return new DynamoDB(dynamoOptions)
}

/**
 *
 * @param {import("@equinox-js/core").ITimelineEvent<import("@equinox-js/core").EncodedBody>} ev
 * @returns {import("@equinox-js/core").ITimelineEvent<Buffer>}
 */
function inflate(ev) {
  if (ev.data && ev.data.body.length)
    ev.data = JSON.parse(Codec.smartDecompress(ev.data).toString("utf-8"))
  if (ev.meta && ev.meta.body.length)
    ev.meta = JSON.parse(Codec.smartDecompress(ev.meta).toString("utf-8"))
  return ev
}

program
  .command("read-stream")
  .argument("<stream-name>")
  .requiredOption("-t, --table-name <table-name>", "Table name")
  .option("-at, --archive-table-name <table-name>", "Archive table name")
  .option("-E, --endpoint <endpoint>", "DynamoDB Endpoint")
  .option("--json", "Output as JSON")
  .action(async (streamName, options) => {
    const ddb = createDynamoClient(options)
    const storeClient = new DynamoStoreClient(ddb)
    const context = new DynamoStoreContext({
      client: storeClient,
      tableName: options.tableName,
      tip: TipOptions.create({}),
      query: QueryOptions.create({}),
    })
    const eventsContext = new EventsContext(context)
    const events = await eventsContext.read(streamName)

    if (options.json) {
      for (const event of events) {
        console.log(JSON.stringify(inflate(event)))
      }
      return
    }
    for (const event of events) {
      inflate(event)
      const parts = [
        chalk.Scalar(event.time.toLocaleString()),
        chalk.String(event.type),
        event.data ? renderObject(event.data) : "",
      ]
      console.log(parts.join(" | "))
    }
  })

program
  .command("create-table")
  .option("-E, --endpoint <endpoint>", "DynamoDB Endpoint")
  .option("--name <table-name>", "name of table")
  .option("-bm --billing-mode <billing-mode>", "billing mode of table", BillingMode.PAY_PER_REQUEST)
  .option("--rus <rus>", "Read capacity")
  .option("--wus <rus>", "Write capacity")
  .option("--table-class <table-class>", "Table class", TableClass.STANDARD)
  .option("--stream <stream>", "Stream mode", StreamViewType.NEW_IMAGE)
  .action(async (options) => {
    const ddb = createDynamoClient(options)
    try {
      console.log(`${chalk.Text("Creating table")} ${chalk.String(options.name)}`)
      console.log(`${chalk.Text("Options: ")} ${renderObject(options)}`)
      await ddb.createTable({
        TableName: options.name,
        AttributeDefinitions: [
          { AttributeName: "p", AttributeType: ScalarAttributeType.S },
          { AttributeName: "i", AttributeType: ScalarAttributeType.N },
        ],
        KeySchema: [
          { AttributeName: "p", KeyType: KeyType.HASH },
          { AttributeName: "i", KeyType: KeyType.RANGE },
        ],
        TableClass: options.tableClass,
        BillingMode: options.billingMode,
        ProvisionedThroughput:
          options.billingMode === BillingMode.PROVISIONED
            ? { ReadCapacityUnits: options.rus, WriteCapacityUnits: options.wus }
            : undefined,
        StreamSpecification:
          options.stream === "none"
            ? undefined
            : { StreamEnabled: true, StreamViewType: options.stream },
      })
    } catch (e) {
      console.error(e)
    }
  })

await program.parseAsync(process.argv)
