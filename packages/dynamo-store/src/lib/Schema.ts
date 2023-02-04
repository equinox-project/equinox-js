import { Event } from "./Event"
import * as InternalBody from "./InternalBody"
import { Unfold } from "./Unfold"
import { Batch } from "./Batch"
import { map } from "./Array"

export type EventSchema = {
  t: { S: string } // NOTE there has to be a single non-`option` field per record, or a trailing insert will be stripped
  d?: { B: Uint8Array }
  D?: { N: string } // D carries encoding, None -> 0 // required
  m?: { B: Uint8Array }
  M?: { N: string } // M carries encoding, None -> 0
  x?: { S: string }
  y?: { S: string }
}

export const eventToSchema = (x: Event): EventSchema => {
  const [d, D] = InternalBody.toBufferAndEncoding(x.data)
  const [m, M] = InternalBody.toBufferAndEncoding(x.meta)
  const result: EventSchema = { t: { S: x.timestamp.toISOString() } }
  if (d) {
    result.d = { B: d }
    if (D) result.D = { N: String(D) }
  }
  if (m) {
    result.m = { B: m }
    if (M) result.M = { N: String(M) }
  }
  if (x.correlationId) result.x = { S: x.correlationId }
  if (x.causationId) result.y = { S: x.causationId }
  return result
}

export const eventsToSchema = (events: Event[]): [{ S: string }[], { M: EventSchema }[]] => {
  const c: { S: string }[] = new Array(events.length)
  const e: { M: EventSchema }[] = new Array(events.length)
  for (let i = 0; i < events.length; ++i) {
    c[i] = { S: events[i].type }
    e[i] = { M: eventToSchema(events[i]) }
  }
  return [c, e]
}
export type UnfoldSchema = {
  i: { N: string }
  t: { S: string }
  c: { S: string } // required
  d?: { B: Uint8Array }
  D?: { N: string } // D carries encoding, None -> 0 // required
  m?: { B: Uint8Array }
  M?: { N: string } // M carries encoding, None -> 0
}

export const unfoldToSchema = (x: Unfold): { M: UnfoldSchema } => {
  const result: UnfoldSchema = { i: { N: String(x.index) }, t: { S: x.timestamp.toISOString() }, c: { S: x.type } }

  const [d, D] = InternalBody.toBufferAndEncoding(x.data)
  const [m, M] = InternalBody.toBufferAndEncoding(x.meta)
  if (d) {
    result.d = { B: d }
    if (D) result.D = { N: String(D) }
  }
  if (m) {
    result.m = { B: m }
    if (M) result.M = { N: String(M) }
  }
  return { M: result }
}

export const unfoldsToSchema = map(unfoldToSchema)

export const unfoldOfSchema = ({ M: x }: { M: UnfoldSchema }): Unfold => ({
  index: BigInt(x.i.N),
  timestamp: new Date(x.t.S),
  type: x.c.S,
  data: InternalBody.ofBufferAndEncoding(x.d?.B, x.D ? Number(x.D.N) : undefined),
  meta: InternalBody.ofBufferAndEncoding(x.m?.B, x.M ? Number(x.M.N) : undefined),
})
const unfoldsOfSchemas = map(unfoldOfSchema)

export type Schema = {
  p: { S: string } // HashKey
  i: { N: string } // RangeKey
  b?: { N: string } // iff Tip: bytes in predecessor batches
  etag?: { S: string }
  n: { N: string }
  // Count of items written in the most recent insert/update - used by the DDB Streams Consumer to identify the fresh events
  a: { N: string }
  // NOTE the per-event e.c values are actually stored here, so they can be selected out without hydrating the bodies
  c: { L: { S: string }[] }
  // NOTE as per Event, but without c and t fields; we instead unroll those as arrays at top level
  e: { L: { M: EventSchema }[] }
  u: { L: { M: UnfoldSchema }[] }
}

export const schemaToBatch = (x: Schema): Batch => {
  const n = BigInt(x.n.N)
  const e = x.e.L
  const baseIndex = n - BigInt(e.length)
  const events: Event[] = new Array(e.length)
  for (let i = 0; i < x.e.L.length; ++i) {
    const e = x.e.L[i].M
    const c = x.c.L[i].S

    const data = InternalBody.ofBufferAndEncoding(e.d?.B, e.D ? Number(e.D.N) : undefined)
    const meta = InternalBody.ofBufferAndEncoding(e.m?.B, e.M ? Number(e.M.N) : undefined)
    events[i] = {
      index: baseIndex + BigInt(i),
      type: c,
      timestamp: new Date(e.t.S),
      data: data,
      meta: meta,
      correlationId: e.x?.S,
      causationId: e.y?.S,
    }
  }
  return {
    streamName: x.p.S,
    bytes: x.b ? Number(x.b.N) : undefined,
    index: BigInt(x.i.N),
    etag: x.etag?.S,
    version: BigInt(x.n.N),
    events: events,
    unfolds: unfoldsOfSchemas(x.u.L),
  }
}
