import { Pool } from "pg"
import {
  MessageDbConnection,
  MessageDbContext,
  type CachingStrategy,
} from "@equinox-js/message-db"
import { MemoryCache } from "@equinox-js/core"

const pool = new Pool({
  connectionString:
  'postgres://message_store:@127.0.0.1:5432'
})
const connection = MessageDbConnection.build(pool)
export const mdbContext = new MessageDbContext(connection, 500)

const cache = new MemoryCache()
export const caching: CachingStrategy = {
  type: "SlidingWindow",
  windowInMs: 20 * 60 * 1000,
  cache,
}
