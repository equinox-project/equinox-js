import { Client } from "@libsql/client"

export async function initializeDatabase(client: Client) {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS messages (
      global_position INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL,
      id CHAR(36) NOT NULL,
      stream_name CHAR(127) NOT NULL,
      category CHAR(127) NOT NULL,
      type CHAR(127) NOT NULL,
      data TEXT,
      metadata TEXT,
      time DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (stream_name, position),
      UNIQUE (id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_category on messages(category, global_position);

    CREATE TABLE IF NOT EXISTS snapshots (
      stream_name CHAR(127) NOT NULL PRIMARY KEY,
      category CHAR(127) NOT NULL,
      type CHAR(127) NOT NULL,
      data TEXT,
      time DATETIME DEFAULT CURRENT_TIMESTAMP,
      position INTEGER NOT NULL,
      id CHAR(36) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_category on snapshots(category, type);
  `)
}
