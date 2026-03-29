import {
  BillingMode,
  DynamoDB,
  KeyType,
  ScalarAttributeType,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb"
import { ChargeId, GuestStayId } from "../src/domain/Types.js"
import { DynamoDBStreams, ShardIteratorType } from "@aws-sdk/client-dynamodb-streams"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"
import {
  AppendsPartitionId,
  DynamoStoreIngester,
  IndexStreamId,
} from "@equinox-js/dynamo-store-indexer"
import { setTimeout } from "node:timers/promises"

export const randomStays = (min = 0) => {
  const result: { stayId: GuestStayId; chargeId: ChargeId; amount: number }[] = []
  const count = Math.max(min, Math.floor(Math.random() * 10))
  for (let i = 0; i < count; ++i) {
    const stayId = GuestStayId.create()
    const chargeId = ChargeId.create()
    const amount = Math.floor(Math.random() * 100)
    result.push({ stayId, chargeId, amount })
  }
  return result
}

export const localDynamoConfig = {
  region: "local",
  endpoint: "http://127.0.0.1:8000",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
}

export async function createTable(ddb: DynamoDB, tableName: string, streamEnabled: boolean) {
  await ddb.createTable({
    BillingMode: BillingMode.PAY_PER_REQUEST,
    AttributeDefinitions: [
      { AttributeName: "p", AttributeType: ScalarAttributeType.S },
      { AttributeName: "i", AttributeType: ScalarAttributeType.N },
    ],
    TableName: tableName,
    KeySchema: [
      { AttributeName: "p", KeyType: KeyType.HASH },
      { AttributeName: "i", KeyType: KeyType.RANGE },
    ],
    StreamSpecification: streamEnabled
      ? { StreamEnabled: true, StreamViewType: "NEW_IMAGE" }
      : undefined,
  })
  await waitUntilTableExists({ client: ddb, maxWaitTime: 60 }, { TableName: tableName })
}

export async function startLocalDynamoIndexer(tableName: string, indexTableName: string) {
  const ddb = new DynamoDB(localDynamoConfig)
  const streams = new DynamoDBStreams(localDynamoConfig)
  const context = new DynamoStoreContext({
    client: new DynamoStoreClient(ddb),
    tableName: indexTableName,
    tip: TipOptions.create({}),
    query: QueryOptions.create({}),
  })
  const ingester = new DynamoStoreIngester(context)
  const ctrl = new AbortController()

  const { Table } = await ddb.describeTable({ TableName: tableName })
  const streamArn = Table?.LatestStreamArn
  if (!streamArn) throw new Error(`No stream arn for table ${tableName}`)

  const { StreamDescription } = await streams.describeStream({ StreamArn: streamArn })
  const shardId = StreamDescription?.Shards?.[0]?.ShardId
  if (!shardId) throw new Error(`No shard found for stream ${streamArn}`)

  const { ShardIterator } = await streams.getShardIterator({
    StreamArn: streamArn,
    ShardId: shardId,
    ShardIteratorType: ShardIteratorType.TRIM_HORIZON,
  })

  const worker = (async () => {
    let iterator = ShardIterator
    while (iterator && !ctrl.signal.aborted) {
      const res = await streams.getRecords(
        { ShardIterator: iterator },
        { abortSignal: ctrl.signal as any },
      )
      if (res.Records?.length) {
        const spans = res.Records.flatMap((record) => {
          if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") return []

          const updated = record.dynamodb?.NewImage
          const key = record.dynamodb?.Keys?.p?.S
          if (!updated || !key || key[0] === "$") return []

          const appendedLen = updated.a?.N != null ? Number(updated.a.N) : 0
          if (appendedLen === 0) return []

          const allBatchEventTypes = updated.c?.L?.map((x) => x.S!).filter(Boolean) ?? []
          const appendedEventTypes = allBatchEventTypes.slice(
            allBatchEventTypes.length - appendedLen,
          )
          if (appendedEventTypes.length === 0) return []

          const n = Number(updated.n!.N)
          return [
            {
              p: IndexStreamId.ofString(key),
              i: n - appendedEventTypes.length,
              c: appendedEventTypes,
            },
          ]
        })
        if (spans.length) {
          await ingester.service.ingestWithoutConcurrency(AppendsPartitionId.wellKnownId, spans)
        }
      } else {
        await setTimeout(50)
      }
      iterator = res.NextShardIterator
    }
  })()

  return {
    stop: async () => {
      ctrl.abort()
      await worker.catch((err) => {
        if (ctrl.signal.aborted) return
        throw err
      })
    },
  }
}
