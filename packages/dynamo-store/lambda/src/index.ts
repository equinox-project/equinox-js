import { DynamoDBStreamHandler } from "aws-lambda"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoStoreIngester } from "@equinox-js/dynamo-store-indexer"
import * as Handler from "./Handler.js"

const itemCutoffKiB = 48

const LOCALSTACK_HOSTNAME = process.env.LOCALSTACK_HOSTNAME
const ENDPOINT = `http://${LOCALSTACK_HOSTNAME}:8000`
if (LOCALSTACK_HOSTNAME) {
  process.env.AWS_SECRET_ACCESS_KEY = "test"
  process.env.AWS_ACCESS_KEY_ID = "test"
  console.log("USING LOCALSTACK CONFIG")
}
const CLIENT_CONFIG = LOCALSTACK_HOSTNAME ? { endpoint: ENDPOINT } : {}
const ddbClient = new DynamoDB(CLIENT_CONFIG)

const indexTableName = process.env.INDEX_TABLE_NAME
if (indexTableName == null) throw new Error('Missing environment variable "INDEX_TABLE_NAME"')
const client = new DynamoStoreClient(ddbClient)
const context = new DynamoStoreContext({
  client,
  tableName: indexTableName,
  tip: TipOptions.create({ maxBytes: itemCutoffKiB * 1024 }),
  query: QueryOptions.create({}),
})
export const ingester = new DynamoStoreIngester(context)

export const handler: DynamoDBStreamHandler = async (event, _context) => {
  console.log("Handling event")
  await Handler.handle(ingester.service, event.Records)
}
