import { DynamoDBStreamHandler } from "aws-lambda"
import { DynamoStoreClient, DynamoStoreContext } from "@equinox-js/dynamo-store"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoStoreIngester } from "@equinox-js/dynamo-store-indexer"
import * as Handler from "./lib/Handler"

const itemCutoffKiB = 48
const ddbClient =
  process.env.LOCAL === "true"
    ? new DynamoDB({
        region: "local",
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
        endpoint: "http://127.0.0.1:8000",
      })
    : new DynamoDB({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION })

const indexTableName = process.env.INDEX_TABLE_NAME
if (indexTableName == null) throw new Error("Missing environment variable INDEX_TABLE_NAME")
const client = DynamoStoreClient.build(ddbClient, indexTableName)
const context = new DynamoStoreContext(client, itemCutoffKiB * 1024)
export const ingester = new DynamoStoreIngester(context)

export const handler: DynamoDBStreamHandler = async (event, _context) => {
  await Handler.handle(ingester.service, event.Records)
}
