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

export const leaderPool = lazy(() => createPool(process.env.MDB_CONN_STR)!)
export const followerPool = lazy(() => createPool(process.env.MDB_RO_CONN_STR))

function createMessageDbConfig(): Config {
  return {
    store: Store.MessageDb,
    context: MessageDbContext.create({
      leaderPool: leaderPool(),
      followerPool: followerPool(),
      batchSize: 500,
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

export function createConfig(): Config {
  switch (process.env.STORE) {
    case "message-db":
      return createMessageDbConfig()
    case "dynamo":
      return createDynamoConfig()
    case "memory":
      return { store: Store.Memory, context: new VolatileStore<string>() }
  }
  throw new Error(`Unknown store: ${process.env.STORE}`)
}
