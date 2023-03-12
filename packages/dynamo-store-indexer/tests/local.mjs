import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoStoreClient, DynamoStoreContext } from "@equinox-js/dynamo-store"
import { DynamoStoreSourceClient } from "../src/lib/DynamoStoreSource"
import { Checkpoint } from "../src"
import { Codec } from "@equinox-js/core"

const ddb = new DynamoDB({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://127.0.0.1:8000",
})

const tableName = process.env.TABLE_NAME || "sample_events"
const indexTableName = process.env.INDEX_TABLE_NAME || "sample_events_index"

const client = DynamoStoreClient.build(ddb, tableName)
const indexClient = DynamoStoreClient.build(ddb, indexTableName)
const withBodies = { type: "Hydrated", categoryFilter: () => true, degreeOfParallelism: 5, context: new DynamoStoreContext(client) }
const source = new DynamoStoreSourceClient(indexClient, withBodies)

const tranches = await source.listTranches()
const codec = Codec.deflate(Codec.json())
for await (const batch of source.crawl(tranches[0], Checkpoint.initial)) {
  console.log(batch.checkpoint, batch.isTail, batch.items.length)
  for (const [stream, event] of batch.items) {
    console.log(stream, await codec.tryDecode(event))
  }
}
