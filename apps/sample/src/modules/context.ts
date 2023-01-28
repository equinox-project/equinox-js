import pg from "pg"
import { MessageDbConnection, MessageDbContext, type CachingStrategy } from "@equinox-js/message-db"
import { MemoryCache } from "@equinox-js/core"
import * as Ddb from "@equinox-js/dynamo-store"
import { DynamoDB } from "@aws-sdk/client-dynamodb"

const pool = new pg.Pool({
  connectionString: "postgres://message_store:@127.0.0.1:5432",
})
const connection = MessageDbConnection.build(pool)
export const mdbContext = new MessageDbContext(connection, 500)

const cache = new MemoryCache()
export const caching: CachingStrategy = {
  type: "SlidingWindow",
  windowInMs: 20 * 60 * 1000,
  cache,
}

const ddb = new DynamoDB({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://localhost:8000",
})

export const dynamoStoreClient = Ddb.DynamoStoreClient.build(ddb, "sample_events")
export const ddbContext = new Ddb.DynamoStoreContext(dynamoStoreClient)
