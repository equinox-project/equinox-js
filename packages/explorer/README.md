# Equinox Explorer

A tool allowing you to visualise and explore your event store.

- Recently modified streams
- Most active categories
- See state changes over time for a particular stream
- View the causation tree for an event

## Usage

### 1. Install

```sh
$ pnpm add -D @equinox-js/explorer@latest
```

### 2. Create a configuration file

```ts
// src/explorer-config.ts
export const categories = [
  { name: Invoice.Stream.category, codec: Invoice.Events.codec, fold: Invoice.Fold },
  // ...
]
```

### 3. Add a script to your package.json

```json
{
  "scripts": {
    "explorer": "NODE_PATH=./node_modules eqx-explorer -cs $MDB_RO_CONN_STR -c ./src/explorer-config.ts"
  }
}
```

### 4. Open your browser

By default the explorer will be hosted on [http://localhost:3000](http://localhost:3000)

## Notes

### Esbuild

The explorer uses esbuild under the hood to compile your config file because we can't simply import a TS file.
This can cause some unforessen issues but generally seems to work fine.

### Indices

The queries made by the explorer against the messages table do benefit from a couple of indices.

```sql
-- Used to render the main page view of events in the last 7 days
create index if not exists idx_messages_time_category on messages(time, category(stream_name), global_position);
-- Used to efficiently look up all correlated events
create index if not exists idx_messages_correlation_id on messages((metadata->>'$correlationId'), global_position);
```


