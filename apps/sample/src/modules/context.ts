import "./trace"
import { MemoryCache } from "@equinox-js/core"
import * as Ddb from "@equinox-js/dynamo-store"
import { DynamoDB } from "@aws-sdk/client-dynamodb"

const cache = new MemoryCache()
export const caching: Ddb.CachingStrategy.CachingStrategy = {
  type: "SlidingWindow",
  windowInMs: 20 * 60 * 1000,
  cache,
}

const ddb = new DynamoDB({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://127.0.0.1:8000",
})

export const dynamoStoreClient = Ddb.DynamoStoreClient.build(ddb, "sample_events")
export const ddbContext = new Ddb.DynamoStoreContext(dynamoStoreClient)
