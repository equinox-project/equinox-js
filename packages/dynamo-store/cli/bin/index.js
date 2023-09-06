#!/usr/bin/env node

import { Command } from "commander"
import zlib from "zlib"

import { DynamoDB } from "@aws-sdk/client-dynamodb"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  EventsContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"
import { renderObject, chalk } from "../src/render.js"

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

function inflate(ev) {
  if (!ev.data?.length) delete ev.data
  if (!ev.meta?.length) delete ev.meta
  if (ev.data) ev.data = JSON.parse(Buffer.from(zlib.inflateSync(ev.data)).toString("utf-8"))
  if (ev.meta) ev.meta = JSON.parse(Buffer.from(zlib.inflateSync(ev.meta)).toString("utf-8"))
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
      const parts = [
        chalk.Scalar(event.time.toLocaleString()),
        chalk.String(event.type),
        event.data
          ? renderObject(JSON.parse(Buffer.from(zlib.inflateSync(event.data)).toString("utf-8")))
          : "",
      ]
      console.log(parts.join(" | "))
    }
  })

await program.parseAsync(process.argv)
