// src/lib/Category.ts
import * as Equinox from "@equinox-js/core";

// src/lib/Token.ts
var create = (version) => ({
  value: version,
  version: version + 1n
});
var streamVersion = (token) => token.value;
var shouldSnapshot = (batchSize, prev, next) => {
  const previousVersion = prev.version;
  const nextVersion = next.version;
  const estimatedSnapshotPos = previousVersion - previousVersion % BigInt(batchSize);
  return nextVersion - estimatedSnapshotPos >= BigInt(batchSize);
};
var supersedes = (current, x) => x.version > current.version;

// src/lib/Snapshot.ts
var snapshotCategory = (original) => original + ":snapshot";
var streamName = (category, streamId) => `${category}-${streamId}`;
var streamVersion2 = (evt) => {
  const meta2 = evt.metadata;
  return meta2 ? BigInt(meta2.streamVersion) : -1n;
};
var meta = (token) => ({
  streamVersion: String(streamVersion(token))
});
var decode = (tryDecode, events) => {
  if (events.length > 0) {
    const decoded = tryDecode(events[0]);
    if (decoded != null)
      return [create(streamVersion2(events[0])), decoded];
  }
  return null;
};

// src/lib/Write.ts
import { SpanKind, trace } from "@opentelemetry/api";
var tracer = trace.getTracer("@birdiecare/eqx-message-db", "1.0.0");
function writeEvents(conn, category, streamId, streamName2, version, events) {
  return tracer.startActiveSpan(
    "WriteEvents",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "eqx.category": category,
        "eqx.stream_id": streamId,
        "eqx.stream_name": streamName2,
        "eqx.expected_version": Number(version),
        "eqx.count": events.length
      }
    },
    (span) => conn.writeMessages(streamName2, events, version).finally(() => span.end())
  );
}

// src/lib/Read.ts
import { context, SpanKind as SpanKind2, trace as trace2 } from "@opentelemetry/api";
var tracer2 = trace2.getTracer("@birdiecare/eqx-message-db", "1.0.0");
var toSlice = (events, isLast) => {
  const lastVersion = events.length === 0 ? -1n : events[events.length - 1].position;
  return { messages: events, isEnd: isLast, lastVersion };
};
var readSliceAsync = async (reader, streamName2, batchSize, startPos, requiresLeader) => {
  const page = await reader.readStream(
    streamName2,
    startPos,
    batchSize,
    requiresLeader
  );
  const isLast = page.length < batchSize;
  return toSlice(page, isLast);
};
var readLastEventAsync = async (reader, streamName2, requiresLeader, eventType) => {
  const events = await reader.readLastEvent(
    streamName2,
    requiresLeader,
    eventType
  );
  return toSlice(events == null ? [] : [events], false);
};
function loggedReadSlice(reader, streamName2, batchSize, startPos, batchIndex, requiresLeader) {
  return tracer2.startActiveSpan(
    "ReadSlice",
    {
      kind: SpanKind2.CLIENT,
      attributes: {
        "eqx.stream_name": streamName2,
        "eqx.batch_index": batchIndex,
        "eqx.start_position": Number(startPos),
        "eqx.requires_leader": requiresLeader
      }
    },
    (span) => readSliceAsync(reader, streamName2, batchSize, startPos, requiresLeader).then((slice) => {
      span.setAttributes({
        "eqx.count": slice.messages.length,
        "eqx.last_version": Number(slice.lastVersion)
      });
      return slice;
    }).finally(() => span.end())
  );
}
function readBatches(readSlice, maxPermittedReads, startPosition) {
  async function* loop(batchCount, pos) {
    if (maxPermittedReads && batchCount >= maxPermittedReads)
      throw new Error("Batch limit exceeded");
    const slice = await readSlice(pos, batchCount);
    yield [slice.lastVersion, slice.messages];
    if (!slice.isEnd) {
      yield* loop(batchCount + 1, slice.lastVersion + 1n);
    }
  }
  return loop(0, startPosition);
}
function loadForwardsFrom(reader, batchSize, maxPermittedBatchReads, streamName2, startPosition, requiresLeader) {
  const mergeBatches = async (batches) => {
    let versionFromStream = -1n;
    const events = [];
    for await (const [version, messages] of batches) {
      versionFromStream = version;
      for (let i = 0; i < messages.length; ++i)
        events.push(messages[i]);
    }
    return [versionFromStream, events];
  };
  const span = trace2.getSpan(context.active());
  span?.setAttributes({
    "eqx.batch_size": batchSize,
    "eqx.start_position": Number(startPosition),
    "eqx.load_method": "BatchForward",
    "eqx.require_leader": requiresLeader
  });
  const readSlice = (start, index) => loggedReadSlice(reader, streamName2, batchSize, start, index, requiresLeader);
  return mergeBatches(
    readBatches(readSlice, maxPermittedBatchReads, startPosition)
  );
}
function loadLastEvent(reader, requiresLeader, streamName2, eventType) {
  trace2.getSpan(context.active())?.setAttribute("eqx.load_method", "Last");
  return tracer2.startActiveSpan(
    "ReadLast",
    {
      kind: SpanKind2.CLIENT,
      attributes: {
        "eqx.stream_name": streamName2,
        "eqx.require_leader": requiresLeader
      }
    },
    (span) => readLastEventAsync(reader, streamName2, requiresLeader, eventType).then((s) => {
      span.setAttribute("eqx.last_version", Number(s.lastVersion));
      return [s.lastVersion, s.messages];
    }).finally(() => span.end())
  );
}

// src/lib/Caching.ts
import {
  CacheEntry
} from "@equinox-js/core";
var Decorator = class {
  constructor(inner, updateCache) {
    this.inner = inner;
    this.updateCache = updateCache;
    this.cache = async (streamName2, inner2) => {
      const tokenAndState = await inner2;
      await updateCache(streamName2, tokenAndState);
      return tokenAndState;
    };
  }
  load(categoryName, streamId, streamName2, allowStale, requireLeader) {
    return this.cache(
      streamName2,
      this.inner.load(
        categoryName,
        streamId,
        streamName2,
        allowStale,
        requireLeader
      )
    );
  }
  async trySync(categoryName, streamId, streamName2, context4, originToken, originState, events) {
    const result = await this.inner.trySync(
      categoryName,
      streamId,
      streamName2,
      context4,
      originToken,
      originState,
      events
    );
    switch (result.type) {
      case "Conflict":
        return {
          type: "Conflict",
          resync: () => this.cache(streamName2, result.resync())
        };
      case "Written":
        await this.updateCache(streamName2, result.data);
        return { type: "Written", data: result.data };
    }
  }
};
function applyCacheUpdatesWithSlidingExpiration(cache, prefix, slidingExpirationInMs, category, supersedes2) {
  const mkCacheEntry = ([initialToken, initialState]) => new CacheEntry(initialToken, initialState);
  const options = { relative: slidingExpirationInMs };
  const addOrUpdateSlidingExpirationCacheEntry = (streamName2, value) => cache.updateIfNewer(
    prefix + streamName2,
    options,
    supersedes2,
    mkCacheEntry(value)
  );
  return new Decorator(
    category,
    addOrUpdateSlidingExpirationCacheEntry
  );
}
function applyCacheUpdatesWithFixedTimeSpan(cache, prefix, lifetimeInMs, category, supersedes2) {
  const mkCacheEntry = ([initialToken, initialState]) => new CacheEntry(initialToken, initialState);
  const addOrUpdateFixedLifetimeCacheEntry = (streamName2, value) => {
    const expirationPoint = Date.now() + lifetimeInMs;
    const options = { absolute: expirationPoint };
    return cache.updateIfNewer(
      prefix + streamName2,
      options,
      supersedes2,
      mkCacheEntry(value)
    );
  };
  return new Decorator(category, addOrUpdateFixedLifetimeCacheEntry);
}

// src/lib/Category.ts
import { context as context3, trace as trace4 } from "@opentelemetry/api";

// src/lib/MessageDbClient.ts
import { randomUUID } from "crypto";
import { trace as trace3, context as context2, propagation, SpanStatusCode } from "@opentelemetry/api";
var MessageDbWriter = class {
  constructor(pool) {
    this.pool = pool;
  }
  async writeMessages(streamName2, messages, expectedVersion) {
    const client = await this.pool.connect();
    let position = -1n;
    try {
      await client.query("BEGIN");
      for (let i = 0; i < messages.length; ++i) {
        const message = messages[i];
        const metadata = message.metadata || {};
        propagation.inject(context2.active(), metadata);
        const results = await client.query(
          `select message_store.write_message($1, $2, $3, $4, $5, $6)`,
          [
            message.id || randomUUID(),
            streamName2,
            message.type,
            JSON.stringify(message.data),
            JSON.stringify(metadata || null),
            expectedVersion == null ? null : Number(expectedVersion++)
          ]
        );
        position = BigInt(results.rows[0].write_message);
      }
      await client.query("COMMIT");
    } catch (err) {
      const span = trace3.getActiveSpan();
      span?.recordException(err);
      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: "ConflictUnknown"
      });
      console.error(err);
      return { type: "ConflictUnknown" };
    } finally {
      client.release();
    }
    return { type: "Written", position };
  }
};
var MessageDbReader = class {
  constructor(pool, leaderPool) {
    this.pool = pool;
    this.leaderPool = leaderPool;
  }
  connect(requiresLeader) {
    if (requiresLeader)
      return this.leaderPool.connect();
    return this.pool.connect();
  }
  async readLastEvent(streamName2, requiresLeader, eventType) {
    const client = await this.connect(requiresLeader);
    try {
      const result = await client.query(
        "select * from message_store.get_last_stream_message($1, $2)",
        [streamName2, eventType ?? null]
      );
      return result.rows.map(fromDb)[0];
    } finally {
      client.release();
    }
  }
  async readStream(streamName2, fromPosition, batchSize, requiresLeader) {
    const client = await this.connect(requiresLeader);
    try {
      const result = await client.query(
        `select
           position, type, data, metadata, id::uuid,
           (metadata::jsonb->>'$correlationId')::text,
           (metadata::jsonb->>'$causationId')::text,
           time
         from get_stream_messages($1, $2, $3)`,
        [streamName2, String(fromPosition), batchSize]
      );
      return result.rows.map(fromDb);
    } finally {
      client.release();
    }
  }
};
function fromDb(row) {
  return {
    id: row.id,
    stream_name: row.stream_name,
    time: new Date(row.time),
    type: row.type,
    data: JSON.parse(row.data),
    metadata: JSON.parse(row.metadata || "null"),
    position: BigInt(row.position)
  };
}

// src/lib/Category.ts
function keepMap(arr, fn) {
  const result = [];
  for (let i = 0; i < arr.length; ++i) {
    const value = fn(arr[i]);
    if (value != null)
      result.push(value);
  }
  return result;
}
var MessageDbConnection = class {
  constructor(read, write) {
    this.read = read;
    this.write = write;
  }
  static build(pool, followerPool = pool) {
    return new MessageDbConnection(
      new MessageDbReader(followerPool, pool),
      new MessageDbWriter(pool)
    );
  }
};
var MessageDbContext = class {
  constructor(conn, batchSize, maxBatches) {
    this.conn = conn;
    this.batchSize = batchSize;
    this.maxBatches = maxBatches;
    this.tokenEmpty = create(-1n);
  }
  async loadBatched(streamName2, requireLeader, tryDecode) {
    const [version, events] = await loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName2,
      0n,
      requireLeader
    );
    return [create(version), keepMap(events, tryDecode)];
  }
  async loadLast(streamName2, requireLeader, tryDecode) {
    const [version, events] = await loadLastEvent(
      this.conn.read,
      requireLeader,
      streamName2
    );
    return [create(version), keepMap(events, tryDecode)];
  }
  async loadSnapshot(category, streamId, requireLeader, tryDecode, eventType) {
    const snapshotStream = streamName(category, streamId);
    const [, events] = await loadLastEvent(
      this.conn.read,
      requireLeader,
      snapshotStream,
      eventType
    );
    return decode(tryDecode, events);
  }
  async reload(streamName2, requireLeader, token, tryDecode) {
    const streamVersion3 = streamVersion(token);
    const startPos = streamVersion3 + 1n;
    const [version, events] = await loadForwardsFrom(
      this.conn.read,
      this.batchSize,
      this.maxBatches,
      streamName2,
      startPos,
      requireLeader
    );
    return [
      create(streamVersion3 > version ? streamVersion3 : version),
      keepMap(events, tryDecode)
    ];
  }
  async trySync(category, streamId, streamName2, token, encodedEvents) {
    const streamVersion3 = streamVersion(token);
    const result = await writeEvents(
      this.conn.write,
      category,
      streamId,
      streamName2,
      streamVersion3,
      encodedEvents
    );
    switch (result.type) {
      case "ConflictUnknown":
        return { type: "ConflictUnknown" };
      case "Written": {
        const token2 = create(result.position);
        return { type: "Written", token: token2 };
      }
    }
  }
  async storeSnapshot(categoryName, streamId, event) {
    const snapshotStream = streamName(categoryName, streamId);
    const category = snapshotCategory(categoryName);
    return writeEvents(
      this.conn.write,
      category,
      streamId,
      snapshotStream,
      null,
      [event]
    );
  }
};
var CategoryWithAccessStrategy = class {
  constructor(context4, codec, access = {
    type: "Unoptimized"
  }) {
    this.context = context4;
    this.codec = codec;
    this.access = access;
  }
  async loadAlgorithm(category, streamId, streamName2, requireLeader) {
    switch (this.access?.type) {
      case "Unoptimized":
        return this.context.loadBatched(
          streamName2,
          requireLeader,
          this.codec.decode
        );
      case "LatestKnownEvent":
        return this.context.loadLast(
          streamName2,
          requireLeader,
          this.codec.decode
        );
      case "AdjacentSnapshots": {
        const result = await this.context.loadSnapshot(
          category,
          streamId,
          requireLeader,
          this.codec.decode,
          this.access.eventName
        );
        if (!result)
          return this.context.loadBatched(
            streamName2,
            requireLeader,
            this.codec.decode
          );
        const [pos, snapshotEvent] = result;
        const [token, rest] = await this.context.reload(
          streamName2,
          requireLeader,
          pos,
          this.codec.decode
        );
        return [token, [snapshotEvent].concat(rest)];
      }
    }
  }
  async load_(fold, initial, f) {
    const [token, events] = await f;
    return [token, fold(initial, events)];
  }
  async load(fold, initial, category, streamId, streamName2, requireLeader) {
    return this.load_(
      fold,
      initial,
      this.loadAlgorithm(category, streamId, streamName2, requireLeader)
    );
  }
  async reload(fold, state, streamName2, requireLeader, token) {
    return this.load_(
      fold,
      state,
      this.context.reload(streamName2, requireLeader, token, this.codec.decode)
    );
  }
  async trySync(fold, category, streamId, streamName2, token, state, events, ctx) {
    const encode = (ev) => this.codec.encode(ev, ctx);
    const encodedEvents = events.map(encode);
    const result = await this.context.trySync(
      category,
      streamId,
      streamName2,
      token,
      encodedEvents
    );
    switch (result.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(fold, state, streamName2, true, token)
        };
      case "Written": {
        const state_ = fold(state, events);
        switch (this.access.type) {
          case "LatestKnownEvent":
          case "Unoptimized":
            break;
          case "AdjacentSnapshots":
            if (shouldSnapshot(this.context.batchSize, token, result.token)) {
              await this.storeSnapshot(
                category,
                streamId,
                ctx,
                result.token,
                this.access.toSnapshot(state_)
              );
            }
        }
        return { type: "Written", data: [result.token, state_] };
      }
    }
  }
  async storeSnapshot(category, streamId, ctx, token, snapshotEvent) {
    const event = this.codec.encode(snapshotEvent, ctx);
    event.metadata = meta(token);
    await this.context.storeSnapshot(category, streamId, event);
  }
};
var Folder = class {
  constructor(category, fold, initial, readCache) {
    this.category = category;
    this.fold = fold;
    this.initial = initial;
    this.readCache = readCache;
  }
  async load(categoryName, streamId, streamName2, allowStale, requireLeader) {
    const load = () => this.category.load(
      this.fold,
      this.initial,
      categoryName,
      streamId,
      streamName2,
      requireLeader
    );
    if (!this.readCache) {
      return load();
    }
    const [cache, prefix] = this.readCache;
    const cacheItem = await cache.tryGet(prefix + streamName2);
    trace4.getSpan(context3.active())?.setAttribute("eqx.cache_hit", cacheItem != null);
    if (!cacheItem)
      return load();
    if (allowStale)
      return cacheItem;
    const [token, state] = cacheItem;
    return this.category.reload(
      this.fold,
      state,
      streamName2,
      requireLeader,
      token
    );
  }
  trySync(categoryName, streamId, streamName2, context4, token, originState, events) {
    return this.category.trySync(
      this.fold,
      categoryName,
      streamId,
      streamName2,
      token,
      originState,
      events,
      context4
    );
  }
};
var MessageDbCategory = class extends Equinox.Category {
  constructor(resolveInner, empty) {
    super(resolveInner, empty);
  }
  static build(context4, codec, fold, initial, caching, access) {
    const inner = new CategoryWithAccessStrategy(context4, codec, access);
    const readCache = (() => {
      switch (caching?.type) {
        case void 0:
          return void 0;
        case "SlidingWindow":
        case "FixedTimespan":
          return [caching.cache, null];
        case "SlidingWindowPrefixed":
          return [caching.cache, caching.prefix];
      }
    })();
    const folder = new Folder(inner, fold, initial, readCache);
    const category = (() => {
      switch (caching?.type) {
        case void 0:
          return folder;
        case "SlidingWindow":
          return applyCacheUpdatesWithSlidingExpiration(
            caching.cache,
            "",
            caching.windowInMs,
            folder,
            supersedes
          );
        case "SlidingWindowPrefixed":
          return applyCacheUpdatesWithSlidingExpiration(
            caching.cache,
            caching.prefix,
            caching.windowInMs,
            folder,
            supersedes
          );
        case "FixedTimespan":
          return applyCacheUpdatesWithFixedTimeSpan(
            caching.cache,
            "",
            caching.periodInMs,
            folder,
            supersedes
          );
      }
    })();
    const resolveInner = (categoryName, streamId) => [category, `${categoryName}-${streamId}`];
    const empty = [context4.tokenEmpty, initial];
    return new MessageDbCategory(resolveInner, empty);
  }
};
export {
  MessageDbCategory,
  MessageDbConnection,
  MessageDbContext
};
