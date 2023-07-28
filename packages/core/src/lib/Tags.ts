/* General tags */

/** The full stream name */
export const stream_name = "eqx.stream_name"
/** The `id` of the stream */
export const stream_id = "eqx.stream_id"
/** The category of the stream */
export const category = "eqx.category"
/** The store being used */
export const store = "eqx.store"

/* Information about loading events */

/** The access strategy used to load the stream */
export const access_strategy = "eqx.load.access_strategy"
/** The version of the stream at read time (empty stream = 0) */
export const read_version = "eqx.load.version"
/** The configured batch size */
export const batch_size = "eqx.load.batch_size"
/** The total number of batches loaded from the store */
export const batches = "eqx.load.batches"
/** The total number of events loaded from the store */
export const loaded_count = "eqx.load.count"
/** The total size of events loaded */
export const loaded_bytes = "eqx.load.bytes"
/** The version we load forwards from */
export const loaded_from_version = "eqx.load.from_version"
/** The load method (BatchForward, LatestEvent, BatchBackward, etc) */
export const load_method = "eqx.load.method"
/** Whether the load specified leader node / consistent read etc */
export const requires_leader = "eqx.load.requires_leader"
/** Whether we used a cached state (independent of whether we reloaded) */
export const cache_hit = "eqx.cache.hit"
/** Elapsed ms since cached state was stored or revalidated at time of inspection */
export const cache_age = "eqx.cache.age_ms"
/** Staleness tolerance specified for this request, in ms */
export const max_staleness = "eqx.cache.max_stale_ms"
/** Allow any cached value to be used without reloading the state */
export const allow_stale = "eqx.cache.allow_stale"
/** If a snapshot was read, what version of the stream was it based on */
export const snapshot_version = "eqx.snapshot.version"

/* Information about appending of events */

/** Whether there was at least one conflict during transact */
export const conflict = "eqx.conflict"
/** (if conflict) Sync attempts - 1 */
export const sync_retries = "eqx.conflict.retries"

/** Store level retry */
export const append_retries = "eqx.append.retries"
/** The number of events we appended */
export const append_count = "eqx.append.count"
/** The total bytes we appended */
export const append_bytes = "eqx.append.bytes"
/** Whether a snapshot was written during this transaction */
export const snapshot_written = "eqx.snapshot.written"
/** The new version of the stream after appending events */
export const append_version = "eqx.append.version"
/** In case of conflict, which event types did we try to append */
export const append_types = "eqx.append.types"
