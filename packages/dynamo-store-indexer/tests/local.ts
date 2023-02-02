import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoStoreClient, DynamoStoreContext } from "@equinox-js/dynamo-store"
import { DynamoStoreSourceClient, LoadMode } from "../src/lib/DynamoStoreSource"
import { AppendsEpochId, Checkpoint } from "../src"
import { AsyncCodec } from "@equinox-js/core"

const ddb = new DynamoDB({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://127.0.0.1:8000",
})

const tableName = process.env.TABLE_NAME || "sample_events"
const indexTableName = process.env.INDEX_TABLE_NAME || "sample_events_index"

const client = DynamoStoreClient.build(ddb, tableName)
const indexClient = DynamoStoreClient.build(ddb, indexTableName)
const withoutBodies: LoadMode = { type: "WithoutEventBodies", categoryFilter: () => true }
const withBodies: LoadMode = { type: "Hydrated", categoryFilter: () => true, degreeOfParallelism: 5, context: new DynamoStoreContext(client) }
const sourceNoBody = new DynamoStoreSourceClient(indexClient, withoutBodies)
const source = new DynamoStoreSourceClient(indexClient, withBodies)

const tranches = await source.listTranches()
const codec = AsyncCodec.unsafeEmpty()
for await (const batch of source.crawl(tranches[0], Checkpoint.initial)) {
  console.log(batch.checkpoint, batch.isTail, batch.items.length)
  for (const [stream, event] of batch.items) {
    console.log(stream, await codec.tryDecode(event))
  }
}
