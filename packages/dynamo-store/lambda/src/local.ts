import { DynamoDBStreams, ShardIteratorType } from "@aws-sdk/client-dynamodb-streams"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { handler } from "./index.js"
import { HttpHandlerOptions } from "@aws-sdk/types"

const streams = new DynamoDBStreams({})
const ddb = new DynamoDB({})

async function walkShardIterator(iterator: string | undefined, signal: AbortSignal) {
  while (iterator && !signal.aborted) {
    const httpHandlerOptions: HttpHandlerOptions = { abortSignal: signal }
    const shard = await streams.getRecords({ ShardIterator: iterator }, httpHandlerOptions)
    if (shard.Records?.length) {
      await handler({ Records: shard.Records })
    }
    iterator = shard.NextShardIterator
  }
}

// Fetches the table information for process.env.TABLE_NAME
// reads the ddb stream for that table and forwards the events to the handler
async function main(signal: AbortSignal) {
  let handled = new Map()
  const httpOptions = { abortSignal: signal }
  while (!signal.aborted) {
    try {
      const { Table } = await ddb.describeTable({
        TableName: process.env.TABLE_NAME,
      })
      const { LatestStreamArn } = Table || {}
      if (LatestStreamArn) {
        const { StreamDescription } = await streams.describeStream(
          { StreamArn: LatestStreamArn },
          httpOptions,
        )
        const shards = StreamDescription?.Shards
        console.log(shards?.[0].SequenceNumberRange)
        for (const shard of shards || []) {
          const iter = await streams.getShardIterator(
            {
              StreamArn: LatestStreamArn,
              ShardId: shard.ShardId,
              ShardIteratorType: ShardIteratorType.TRIM_HORIZON,
            },
            httpOptions,
          )
          await walkShardIterator(iter?.ShardIterator, signal)
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (err) {
      console.error(err)
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

const ctrl = new AbortController()
process.on("SIGINT", () => ctrl.abort())
process.on("SIGTERM", () => ctrl.abort())

main(ctrl.signal)
