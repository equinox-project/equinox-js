import * as Handler from "./lib/Handler"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoDBStreams, ShardIteratorType } from "@aws-sdk/client-dynamodb-streams"
import { ingester } from "./index"

const ddb = new DynamoDB({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://127.0.0.1:8000",
})
const streams = new DynamoDBStreams({
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  endpoint: "http://127.0.0.1:8000",
})

const tableName = process.env.TABLE_NAME || ""

async function main() {
  const result = await ddb.describeTable({ TableName: tableName })
  const s = await streams.describeStream({
    StreamArn: result.Table!.LatestStreamArn,
  })
  const shard = await streams.getShardIterator({
    StreamArn: result.Table!.LatestStreamArn,
    ShardId: s.StreamDescription!.Shards![0]!.ShardId,
    ShardIteratorType: ShardIteratorType.AT_SEQUENCE_NUMBER,
    SequenceNumber: s.StreamDescription!.Shards![0]!.SequenceNumberRange!.StartingSequenceNumber,
  })

  let shardIterator = shard.ShardIterator!

  while (true) {
    const x = await streams.getRecords({
      ShardIterator: shardIterator,
    })
    await Handler.handle(ingester.service, (x.Records as any) || [])
    shardIterator = x.NextShardIterator || shardIterator
    await new Promise((res) => setTimeout(res, 1000))
  }
}

main()
