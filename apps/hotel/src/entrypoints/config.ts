import pg from "pg"
import { MessageDbContext } from "@equinox-js/message-db"
import { Config, Store } from "../config/equinox.js"
import { MemoryCache } from "@equinox-js/core"
import { VolatileStore } from "@equinox-js/memory-store"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import {
  DynamoStoreClient,
  DynamoStoreContext,
  QueryOptions,
  TipOptions,
} from "@equinox-js/dynamo-store"
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-source"
import { DynamoCheckpoints, DynamoStoreSource, LoadMode } from "@equinox-js/dynamo-store-source"
import { Sink } from "@equinox-js/propeller"

const pools: pg.Pool[] = []
export async function endPools() {
  for (const pool of pools) {
    await pool.end()
  }
}
export const createPool = (connectionString?: string, max = 10) => {
  if (!connectionString) return
  const pool = new pg.Pool({ connectionString, max })
  pools.push(pool)
  return pool
}

const lazy = <T>(fn: () => T) => {
  let value: T | undefined
  return () => {
    if (value === undefined) value = fn()
    return value
  }
}

export const leaderPool = lazy(() => createPool(process.env.DBURL)!)
export const followerPool = lazy(() => createPool(process.env.DBURL_RO) ?? leaderPool())

function createMessageDbConfig(): Config {
  const batchSize = process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE) : 500
  return {
    store: Store.MessageDb,
    context: MessageDbContext.create({
      leaderPool: leaderPool(),
      followerPool: followerPool(),
      batchSize,
    }),
    cache: new MemoryCache(),
  }
}

function createDynamoClient() {
  return new DynamoDB({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION })
}

export const dynamoDB = lazy(() => createDynamoClient())

function createDynamoConfig(): Config {
  const ddb = dynamoDB()

  const tableName = process.env.TABLE_NAME || "events"
  const archiveTableName = process.env.ARCHIVE_TABLE_NAME
  const client = new DynamoStoreClient(ddb)
  const context = new DynamoStoreContext({
    client,
    tableName,
    archiveTableName,
    tip: TipOptions.create({}),
    query: QueryOptions.create({}),
  })
  return { store: Store.Dynamo, context, cache: new MemoryCache() }
}

export function createConfig(store = process.env.STORE): Config {
  switch (store) {
    case "message-db":
      return createMessageDbConfig()
    case "dynamo":
      return createDynamoConfig()
    case "memory":
      return { store: Store.Memory, context: new VolatileStore<string>() }
  }
  throw new Error(`Unknown store: ${process.env.STORE}`)
}

type SourceOptions = {
  categories: string[]
  groupName: string
  tailSleepIntervalMs: number
  sink: Sink
}

function loadMode(context: DynamoStoreContext) {
  switch (process.env.LOAD_MODE) {
    case "with-data":
      return LoadMode.WithData(10, context)
    default:
      return LoadMode.IndexOnly()
  }
}

export function createSource(config: Config, opts: SourceOptions) {
  switch (config.store) {
    case Store.MessageDb: {
      const checkpoints = new PgCheckpoints(leaderPool())
      return MessageDbSource.create({
        pool: followerPool(),
        sink: opts.sink,
        checkpoints,
        categories: opts.categories,
        groupName: opts.groupName,
        tailSleepIntervalMs: opts.tailSleepIntervalMs,
      })
    }
    case Store.Dynamo: {
      const checkpoints = DynamoCheckpoints.create(config.context, config.cache, 100)
      return DynamoStoreSource.create({
        mode: loadMode(config.context),
        context: config.context,
        batchSizeCutoff: 500,
        sink: opts.sink,
        checkpoints,
        categories: opts.categories,
        groupName: opts.groupName,
        tailSleepIntervalMs: opts.tailSleepIntervalMs,
      })
    }
    case Store.Memory:
      throw new Error("Memory store does not support source creation")
  }
}
