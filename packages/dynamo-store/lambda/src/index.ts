import { DynamoDBRecord, DynamoDBStreamHandler } from "aws-lambda"
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

const ddbClient = new DynamoDB({})

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

type Event = { Records: DynamoDBRecord[] }
export const handler = async (event: Event) => {
  await Handler.handle(ingester.service, event.Records)
}
