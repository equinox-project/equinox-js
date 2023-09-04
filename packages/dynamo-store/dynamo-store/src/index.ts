import {
  AttributeValue,
  ConditionalCheckFailedException,
  DynamoDB,
  QueryCommandOutput,
  ReturnConsumedCapacity,
  TransactWriteItemsInput,
} from "@aws-sdk/client-dynamodb"
import {
  CachingCategory,
  Category,
  ICachingStrategy,
  ICodec,
  IEventData,
  IReloadableCategory,
  ITimelineEvent,
  StreamId,
  StreamName,
  StreamToken,
  SyncResult,
  Tags,
  TokenAndState,
} from "@equinox-js/core"
import { randomUUID } from "crypto"
import { keepMapRev, keepMap } from "./Array.js"
import { trace } from "@opentelemetry/api"

/** A single Domain Event from the array held in a Batch */
type Event = {
  /** Index number within stream, not persisted (computed from Batch's `n` and the index within `e`) */
  i: number

  /** Creation Timestamp, as set by the application layer at the point of rendering the Event */
  t: Date

  /** The Event Type (Case) that defines the content of the Data (and Metadata) fields */
  c: string

  /** Main event body; required */
  d: Buffer

  /** Optional metadata, encoded as per 'd'; can be Empty */
  m: Buffer

  /** CorrelationId; stored as x (signifying transactionId), or null */
  correlationId?: string

  /** CausationId; stored as y (signifying why), or null */
  causationId?: string
}

const uuidNil = "00000000-0000-0000-0000-000000000000"

namespace Event {
  export function bytes(e: Event): number {
    return (
      e.c.length +
      e.d.length +
      e.m.length +
      (e.correlationId?.length ?? 0) +
      (e.causationId?.length ?? 0) +
      20 + // date
      20 // overhead
    )
  }
  export function toTimelineEvent(event: Event): ITimelineEvent<Buffer> {
    return {
      type: event.c,
      index: BigInt(event.i),
      id: uuidNil,
      isUnfold: false,
      size: bytes(event),
      time: event.t,
      data: event.d,
      meta: event.m,
    }
  }

  export function arrayBytes(events: Event[]): number {
    let result = 0
    for (let i = 0; i < events.length; i++) result += bytes(events[i])
    return result
  }
}

/** Compaction/Snapshot/Projection Event based on the state at a given point in time `i` */
type Unfold = {
  /** Base: Stream Position (Version) of State from which this Unfold Event was generated. An unfold from State Version 1 is i=1 and includes event i=1 */
  i: number

  /** Generation datetime */
  t: Date

  /** The Case (Event Type) of this snapshot, used to drive deserialization */
  c: string // required

  /** Event body */
  d: Buffer

  /** Optional metadata, can be Empty */
  m: Buffer
}
namespace Unfold {
  export function bytes(u: Unfold): number {
    return u.c.length + u.d.length + u.m.length + 50
  }
  export function arrayBytes(unfolds: Unfold[]): number {
    let result = 0
    for (let i = 0; i < unfolds.length; i++) result += bytes(unfolds[i])
    return result
  }
  export function toTimelineEvent(unfold: Unfold): ITimelineEvent<Buffer> {
    return {
      type: unfold.c,
      index: BigInt(unfold.i),
      id: uuidNil,
      isUnfold: true,
      size: bytes(unfold),
      time: unfold.t,
      data: unfold.d,
      meta: unfold.m,
    }
  }
}

/**
 * The abstract storage format for a Batch of Events represented in a DynamoDB Item
 * NOTE See Batch.Schema buddy type for what actually gets stored
 * NOTE names are intended to generally align with CosmosStore naming. Key Diffs:
 * - no mandatory `id` and/or requirement for it to be a `string` -> replaced with `i` as an int64
 * (also Tip magic value is tipMagicI: Int32.MaxValue, not "-1")
 * - etag is managed explicitly (on Cosmos DB, its managed by the service and named "_etag")
 */
type Batch = {
  /** streamName */
  p: string

  /** (Tip Batch only) Number of bytes held in predecessor Batches */
  b?: number

  /** base 'i' value for the Events held herein */
  i: number // tipMagicI for the Tip

  /** Marker on which compare-and-swap operations on Tip are predicated */
  etag?: string

  /** `i` value for successor batch (to facilitate identifying which Batch a given startPos is within) */
  n: number

  /** The Domain Events (as opposed to Unfolded Events in `u`) for this page of the stream */
  e: Event[]

  /** Compaction/Snapshot/Projection quasi-events */
  u: Unfold[]
}

namespace Batch {
  export const tipMagicI = 2147483647 // Int32.MaxValue
  export const tipMagicIStr = tipMagicI.toString()
  export function tableKeyForStreamTip(stream: string) {
    return { p: { S: stream }, i: { N: tipMagicIStr } }
  }
  export function isTip(b: Batch): boolean {
    return b.i === tipMagicI
  }

  type EventSchema = {
    t: { S: string } // NOTE there has to be a single non-`option` field per record, or a trailing insert will be stripped
    d?: { B: Buffer }
    m?: { B: Buffer }
    x?: { S: string }
    y?: { S: string }
  }

  type UnfoldSchema = {
    i: { N: string }
    t: { S: string }
    c: { S: string } // required
    d?: { B: Buffer }
    m?: { B: Buffer }
  }

  export type Schema = {
    /** streamName */
    p: { S: string } // hash key
    i: { N: string } // range key
    b?: { N: string } // iff Tip: bytes in predecessor batches
    etag?: { S: string }
    n: { N: string }
    /// Count of events appended to stream with this insert/append.
    /// N/A for calves; all writes go via Tip as only item updates guarantee ordered arrival at Lambda via DDB streams
    a?: { N: string }
    /// NOTE the per-event e.c values are actually stored here, so they can be selected out without hydrating the bodies
    c: { L: { S: string }[] }
    /// NOTE as per Event, but without c and t fields; we instead unroll those as arrays at top level
    e: { L: { M: EventSchema }[] }
    u: { L: { M: UnfoldSchema }[] }
  }

  function toEventSchema(e: Event): EventSchema {
    const result: EventSchema = {} as any
    result.t = { S: e.t.toISOString() }
    if (e.d.length) result.d = { B: e.d }
    if (e.m.length) result.m = { B: e.m }
    if (e.correlationId) result.x = { S: e.correlationId }
    if (e.causationId) result.y = { S: e.causationId }
    return result
  }
  export function eventsToSchema(events: Event[]): [{ S: string }[], { M: EventSchema }[]] {
    const result: { M: EventSchema }[] = new Array(events.length)
    const types: { S: string }[] = new Array(events.length)
    for (let i = 0; i < events.length; i++) {
      types[i] = { S: events[i].c }
      result[i] = { M: toEventSchema(events[i]) }
    }
    return [types, result]
  }

  function toUnfoldSchema(u: Unfold): UnfoldSchema {
    const result: UnfoldSchema = {} as any
    result.i = { N: u.i.toString() }
    result.t = { S: u.t.toISOString() }
    result.c = { S: u.c }
    if (u.d.length) result.d = { B: u.d }
    if (u.m.length) result.m = { B: u.m }
    return result
  }
  export function unfoldsToSchema(unfolds: Unfold[]): { M: UnfoldSchema }[] {
    const result: { M: UnfoldSchema }[] = new Array(unfolds.length)
    for (let i = 0; i < unfolds.length; i++) result[i] = { M: toUnfoldSchema(unfolds[i]) }
    return result
  }
  function ofUnfoldSchema(x: UnfoldSchema): Unfold {
    return {
      i: Number(x.i.N),
      t: new Date(x.t.S),
      c: x.c.S,
      d: x.d?.B ?? Buffer.alloc(0),
      m: x.m?.B ?? Buffer.alloc(0),
    }
  }

  export function ofSchema(x: Schema): Batch {
    const p = x.p.S
    const b = x.b ? Number(x.b.N) : undefined
    const n = Number(x.n.N)
    const baseIndex = n - x.e.L.length
    const events: Event[] = new Array(x.e.L.length)
    for (let i = 0; i < x.e.L.length; i++) {
      const e = x.e.L[i].M
      const c = x.c.L[i].S
      const t = new Date(e.t.S)
      const idx = baseIndex + i
      const d = e.d ? e.d.B : Buffer.alloc(0)
      const m = e.d ? e.d.B : Buffer.alloc(0)
      events[i] = { i: idx, t, c, d, m, correlationId: e.x?.S, causationId: e.y?.S }
    }

    const u = x.u.L.map((x) => ofUnfoldSchema(x.M))

    return {
      p,
      b,
      i: Number(x.i.N),
      etag: x.etag?.S,
      n,
      e: events,
      u,
    }
  }

  export function enumEvents(minIndex: number | undefined, maxIndex: number | undefined, x: Batch) {
    const min = minIndex ?? 0
    const max = maxIndex ?? Number.MAX_SAFE_INTEGER

    return x.e.filter((e) => e.i >= min && e.i <= max)
  }

  export function baseIndex(x: Batch): number {
    return x.n - x.e.length
  }
  export function bytesUnfolds(x: Batch): number {
    return Unfold.arrayBytes(x.u)
  }
  export function bytesBase(x: Batch): number {
    return 80 + x.p.length + (x.etag?.length || 0) + Event.arrayBytes(x.e)
  }
  export function bytesTotal(xs: Batch[]): number {
    let result = 0
    for (let i = 0; i < xs.length; i++) result += bytesBase(xs[i]) + bytesUnfolds(xs[i])
    return result
  }
}

type RequestConsumption = { total: number }
export enum Direction {
  Forward,
  Backward,
}

export namespace Direction {
  export function toString(x: Direction): string {
    switch (x) {
      case Direction.Forward:
        return "Forward"
      case Direction.Backward:
        return "Backward"
    }
  }
}

export type BatchIndices = { isTip: boolean; index: number; n?: number }
export type DynamoExpr = {
  text: string
  condition?: string
  values: Record<string, AttributeValue>
}

type Projected = {
  i: { N: string }
  c: { L: { S: string }[] }
  n: { N: string }
}

export class StoreTable {
  constructor(
    public name: string,
    public client: DynamoDB,
  ) {}

  static create(name: string, client: DynamoDB) {
    return new StoreTable(name, client)
  }

  async tryGetTip(stream: string, consistentRead: boolean) {
    const key = Batch.tableKeyForStreamTip(stream)
    const item = await this.client.getItem({
      TableName: this.name,
      Key: key,
      ConsistentRead: consistentRead,
      ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
    })

    if (!item.Item) return undefined
    return Batch.ofSchema(item.Item as Batch.Schema)
  }

  async tryUpdateTip(stream: string, expr: DynamoExpr) {
    const pk = Batch.tableKeyForStreamTip(stream)
    const result = await this.client.updateItem({
      TableName: this.name,
      Key: pk,
      UpdateExpression: expr.text,
      ConditionExpression: expr.condition,
      ExpressionAttributeValues: expr.values,
      ReturnValues: "ALL_NEW",
    })
    if (!result.Attributes) return undefined
    return Batch.ofSchema(result.Attributes as Batch.Schema)
  }
  async *queryBatches(
    stream: string,
    consistentRead: boolean,
    minN: number | undefined,
    maxI: number | undefined,
    backwards: boolean,
    batchSize: number,
  ): AsyncIterable<Batch[]> {
    const send = (le?: Record<string, any>): Promise<QueryCommandOutput> => {
      const attributes: Record<string, AttributeValue> = {
        ":p": { S: stream },
      }
      if (maxI != null) attributes[":maxI"] = { N: String(maxI) }
      if (minN != null) attributes[":minN"] = { N: String(minN) }

      return this.client.query({
        TableName: this.name,
        KeyConditionExpression: maxI == null ? "p = :p" : "p = :p AND i < :maxI",
        FilterExpression: minN == null ? undefined : "n > :minN",
        ExpressionAttributeValues: attributes,
        Limit: batchSize,
        ExclusiveStartKey: le,
        ScanIndexForward: !backwards,
        ConsistentRead: consistentRead,
        ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
      })
    }
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined
    do {
      const result: QueryCommandOutput = await send(lastEvaluatedKey)
      const items = result.Items?.map((x) => Batch.ofSchema(x as any)) ?? []
      yield items
      lastEvaluatedKey = result.LastEvaluatedKey
    } while (lastEvaluatedKey != null)
  }
  async *queryIAndNOrderByNAscending(stream: string, maxItems: number): AsyncIterable<Projected[]> {
    const send = (le?: Record<string, any>) =>
      this.client.query({
        TableName: this.name,
        KeyConditionExpression: "p = :p",
        ExpressionAttributeValues: {
          ":p": { S: stream },
        },
        ProjectionExpression: "i, c, n",
        Limit: maxItems,
        ExclusiveStartKey: le,
        ScanIndexForward: true,
        ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
      })

    let lastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined
    do {
      const result: QueryCommandOutput = await send(lastEvaluatedKey)
      const items = result.Items?.map((x) => x as Projected) ?? []
      yield items
      lastEvaluatedKey = result.LastEvaluatedKey
    } while (lastEvaluatedKey != null)
  }

  async deleteItem(stream: string, i: bigint) {
    await this.client.deleteItem({
      TableName: this.name,
      Key: { p: { S: stream }, i: { N: String(i) } },
      ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
    })
  }
}

export type Position = {
  index: number
  etag?: string
  calvedBytes: number
  baseBytes: number
  unfoldsBytes: number
  events: Event[]
}

export namespace Position {
  export function fromTip(x: Batch): Position {
    return {
      index: x.n,
      etag: x.etag,
      calvedBytes: x.b ?? 0,
      baseBytes: Batch.bytesBase(x),
      unfoldsBytes: Batch.bytesUnfolds(x),
      events: x.e,
    }
  }
  export const fromElements = (
    p: string,
    b: number,
    n: number,
    e: Event[],
    u: Unfold[],
    etag?: string,
  ): Position => fromTip({ p, i: -1, b, n, e, u, etag })
  export const tryFromBatch = (x: Batch) => (Batch.isTip(x) ? fromTip(x) : undefined)
  export const toIndex = (p?: Position) => (p ? p.index : 0)
  export const toEtag = (p?: Position) => (p ? p.etag : undefined)
  export const toVersionAndStreamBytes = (p?: Position) =>
    p ? [p.index, p.calvedBytes + p.baseBytes] : [0, 0]
  export const null_ = (i: number): Position => ({
    index: i,
    calvedBytes: 0,
    baseBytes: 0,
    unfoldsBytes: 0,
    events: [],
  })
  export const flatten = (p?: Position): Position => p ?? null_(0)
  export const orMinusOneSentinel = (p?: Position): Position => p ?? null_(-1)
}

const compactObjMutable = <T extends Record<string, any>>(
  o: T,
): { [P in keyof T]: NonNullable<T[P]> } => {
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) delete o[k]
  }
  return o as any
}

namespace Sync {
  enum ReqType {
    Append,
    Calve,
  }
  type Req =
    | { type: ReqType.Append; tipWasEmpty: boolean; events: Event[] }
    | {
        type: ReqType.Calve
        calfEvents: Event[]
        appendedEvents: Event[]
      }

  export type ExpectedVersion = number | string
  type ItemType<T> = T extends Array<infer P> ? P : never
  type TransactWriteItem = ItemType<TransactWriteItemsInput["TransactItems"]>
  const updateTip = (table: string, stream: string, expr: DynamoExpr): TransactWriteItem => ({
    Update: {
      TableName: table,
      ConditionExpression: expr.condition,
      Key: Batch.tableKeyForStreamTip(stream),
      UpdateExpression: expr.text,
      ExpressionAttributeValues: expr.values,
    },
  })
  const putItemIfNotExists = (table: string, item: Batch.Schema): TransactWriteItem => ({
    Put: {
      ConditionExpression: "attribute_not_exists(i)",
      TableName: table,
      Item: item,
    },
  })

  function generateRequests(
    table: string,
    stream: string,
    req: Req,
    u_: Unfold[],
    exp: ExpectedVersion,
    b_: number,
    n_: number,
    etag_: string | undefined,
  ): TransactWriteItem[] {
    const u = Batch.unfoldsToSchema(u_)
    const [replaceTipEvents, tipA, [tipC, tipE], maybeCalf] = (() => {
      switch (req.type) {
        case ReqType.Append: {
          const replaceTipEvents = req.tipWasEmpty && req.events.length !== 0
          return [
            replaceTipEvents,
            req.events.length.toString(),
            Batch.eventsToSchema(req.events),
            undefined,
          ] as const
        }
        case ReqType.Calve: {
          const tipIndex = n_ - req.appendedEvents.length
          const calfIndex = tipIndex - req.calfEvents.length
          const tipA = req.appendedEvents.length.toString()
          const [calfC, calfE] = Batch.eventsToSchema(req.calfEvents)
          const calf: Batch.Schema = {
            p: { S: stream },
            i: { N: String(calfIndex) },
            u: { L: [] },
            c: { L: calfC },
            e: { L: calfE },
            n: { N: String(tipIndex) },
          }
          return [true, tipA, Batch.eventsToSchema(req.appendedEvents), calf] as const
        }
      }
    })()
    const genFreshTipItem = (): Batch.Schema =>
      compactObjMutable({
        p: { S: stream },
        i: { N: Batch.tipMagicIStr },
        a: { N: tipA },
        b: { N: String(b_) },
        etag: etag_ ? { S: etag_ } : undefined,
        u: { L: u },
        n: { N: String(n_) },
        e: { L: tipE },
        c: { L: tipC },
      })

    const updateTipIf = (condExpr: string, condValues: Record<string, AttributeValue>) => {
      const updateExpression: DynamoExpr = replaceTipEvents
        ? {
            text: "SET a = :tipA, b = :b, etag = :etag, u = :u, n = :n, e = :tipE, c = :tipC",
            condition: condExpr,
            values: compactObjMutable({
              ...condValues,
              ":tipA": { N: String(tipA) },
              ":b": { N: String(b_) },
              ":u": { L: u },
              ":n": { N: String(n_) },
              ":tipE": { L: tipE },
              ":tipC": { L: tipC },
              ":etag": etag_ ? { S: etag_ } : undefined,
            }),
          }
        : tipE.length === 0
        ? {
            text: "SET a = :tipA, b = :b, etag = :etag, u = :u",
            condition: condExpr,
            values: compactObjMutable({
              ...condValues,
              ":tipA": { N: "0" },
              ":b": { N: String(b_) },
              ":u": { L: u },
              ":etag": etag_ ? { S: etag_ } : undefined,
            }),
          }
        : {
            text: "SET a = :tipA, b = :b, etag = :etag, u = :u, n = :n, e = list_append(e, :tipE), c = list_append(c, :tipC)",
            condition: condExpr,
            values: compactObjMutable({
              ...condValues,
              ":tipA": { N: String(tipA) },
              ":b": { N: String(b_) },
              ":u": { L: u },
              ":n": { N: String(n_) },
              ":tipE": { L: tipE },
              ":tipC": { L: tipC },
              ":etag": etag_ ? { S: etag_ } : undefined,
            }),
          }
      return updateTip(table, stream, updateExpression)
    }
    const tipUpdate =
      exp == null || exp === 0
        ? putItemIfNotExists(table, genFreshTipItem())
        : typeof exp === "string"
        ? updateTipIf("etag = :exp", { ":exp": { S: exp } })
        : updateTipIf("n = :ver", { ":ver": { N: String(exp) } })

    if (maybeCalf) {
      return [putItemIfNotExists(table, maybeCalf), tipUpdate]
    }
    return [tipUpdate]
  }

  type DynamoSyncResult = { type: "Written"; etag: string } | { type: "ConflictUnknown" }

  // prettier-ignore
  async function transact(table: StoreTable, stream: string, req: Req, unfold: Unfold[], exp: ExpectedVersion, bytes: number, n: number): Promise<DynamoSyncResult> {
    const etag_ = randomUUID()
    const actions = generateRequests(table.name, stream, req, unfold, exp, bytes, n, etag_)
    try {
      if (actions.length === 1 && actions[0].Put != null) {
        await table.client.putItem({
          ...actions[0].Put,
          ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
        })
      } else if (actions.length === 1 && actions[0].Update != null) {
        await table.client.updateItem({
          ...actions[0].Update,
          ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
        })
      } else {
        await table.client.transactWriteItems({
          TransactItems: actions,
          ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
        })
      }
      return { type: "Written", etag: etag_ }
    } catch (err: any) {
      if (err instanceof ConditionalCheckFailedException) return { type: "ConflictUnknown" }
      console.error(err)
      throw err
    }
  }

  const maxDynamoDbItemSize = 400 * 1024
  type Result =
    | { type: "ConflictUnknown" }
    | {
        type: "Written"
        etag: string
        predecessorBytes: number
        events: Event[]
        unfolds: Unfold[]
      }
  export async function handle(
    maxEvents: number | undefined,
    maxBytes: number,
    maxEventBytes: number,
    table: StoreTable,
    stream: string,
    pos: Position | undefined,
    exp: (p?: Position) => ExpectedVersion,
    n_: number,
    streamEvents: IEventData<Buffer>[],
    streamUnfolds: IEventData<Buffer>[],
  ): Promise<Result> {
    const baseIndex = n_ - streamEvents.length
    const events = streamEvents.map(
      (e, i): Event => ({
        i: baseIndex + i,
        t: new Date(),
        c: e.type,
        d: e.data ?? Buffer.alloc(0),
        m: e.meta ?? Buffer.alloc(0),
      }),
    )
    const unfolds = streamUnfolds.map(
      (x, i): Unfold => ({
        i: n_,
        t: new Date(),
        c: x.type,
        d: x.data ?? Buffer.alloc(0),
        m: x.meta ?? Buffer.alloc(0),
      }),
    )
    if (events.length === 0 && unfolds.length === 0)
      throw new Error("Must write either events or unfolds")
    const cur = Position.flatten(pos)
    const evtOverflow = maxEvents ? events.length + cur.events.length > maxEvents : false
    const eventBytes = Event.arrayBytes(events) + Event.arrayBytes(cur.events)
    const eventAndUnfoldBytes = eventBytes + Unfold.arrayBytes(unfolds)
    let req: Req
    let predecessorBytes: number
    let tipEvents: Event[]
    if (
      (evtOverflow || eventBytes > maxEventBytes || eventAndUnfoldBytes > maxBytes) &&
      cur.events.length > 0
    ) {
      req = { type: ReqType.Calve, calfEvents: cur.events, appendedEvents: events }
      predecessorBytes = cur.calvedBytes + Event.arrayBytes(cur.events)
      tipEvents = events
    } else {
      req = { type: ReqType.Append, events, tipWasEmpty: cur.events.length === 0 }
      predecessorBytes = cur.calvedBytes
      tipEvents = cur.events.concat(events)
    }
    const res = await transact(table, stream, req, unfolds, exp(pos), predecessorBytes, n_)
    switch (res.type) {
      case "ConflictUnknown":
        return { type: "ConflictUnknown" }
      case "Written":
        return { type: "Written", etag: res.etag, predecessorBytes, events: tipEvents, unfolds }
    }
  }
}

namespace Tip {
  type Res<T> = { type: "Found"; data: T } | { type: "NotFound" } | { type: "NotModified" }

  function compareITimelineEvents(a: ITimelineEvent<any>, b: ITimelineEvent<any>) {
    if (a.index < b.index) return -1
    if (a.index > b.index) return 1
    if (a.isUnfold && !b.isUnfold) return 1
    if (!a.isUnfold && b.isUnfold) return -1
    return 0
  }

  async function get(
    table: StoreTable,
    stream: string,
    consistentRead: boolean,
    maybePos?: Position,
  ): Promise<Res<Batch>> {
    const t = await table.tryGetTip(stream, consistentRead)
    if (t == null) return { type: "NotFound" }
    if (t.etag == Position.toEtag(maybePos)) return { type: "NotModified" }
    return { type: "Found", data: t }
  }

  const enumEventsAndUnfolds = (
    minIndex: number | undefined,
    maxIndex: number | undefined,
    tip: Batch,
  ): ITimelineEvent<Buffer>[] => {
    const span = trace.getActiveSpan()
    const events = Batch.enumEvents(minIndex, maxIndex, tip)
    const result: ITimelineEvent<Buffer>[] = new Array(events.length + tip.u.length)
    for (let i = 0; i < tip.e.length; i++) {
      result[i] = Event.toTimelineEvent(tip.e[i])
    }
    for (let i = 0; i < tip.u.length; i++) {
      result[i + tip.e.length] = Unfold.toTimelineEvent(tip.u[i])
    }
    if (tip.u.length) {
      span?.setAttribute(Tags.snapshot_version, tip.u[0].i)
    }
    return result.sort(compareITimelineEvents)
  }

  export type LoadedTip = {
    position: Position
    baseIndex: number
    events: ITimelineEvent<Buffer>[]
  }

  export async function tryLoad(
    table: StoreTable,
    stream: string,
    consistentRead: boolean,
    position?: Position,
    maxIndex?: number,
  ): Promise<Res<LoadedTip>> {
    const t = await get(table, stream, consistentRead, position)
    const span = trace.getActiveSpan()
    span?.setAttributes({ "eqx.load.tip": true, "eqx.load.tip_result": t.type })
    switch (t.type) {
      case "NotFound":
      case "NotModified":
        return { type: t.type }
      case "Found":
        const tip = t.data
        const minIndex = Position.flatten(position).index
        const pos = Position.fromTip(tip)
        const baseIndex = Batch.baseIndex(tip)
        span?.setAttributes({
          "eqx.load.tip_position": Position.toIndex(pos),
          "eqx.load.tip_base_index": baseIndex,
        })
        return {
          type: "Found",
          data: {
            position: pos,
            baseIndex,
            events: enumEventsAndUnfolds(minIndex, maxIndex, tip),
          },
        }
    }
  }
}

type TryDecode<E> = (e: ITimelineEvent<Buffer>) => E | undefined
namespace Query {
  // prettier-ignore
  const mkQuery = (table: StoreTable, stream: string, consistentRead: boolean, maxItems: number, direction: Direction, minIndex?: number, maxIndex?: number) => 
  // prettier-ignore
    table.queryBatches(stream, consistentRead, minIndex, maxIndex, direction === Direction.Backward, maxItems)

  const tryPick = <T, V>(arr: T[], fn: (x: T) => V | undefined): V | undefined => {
    for (let i = 0; i < arr.length; i++) {
      const y = fn(arr[i])
      if (y != null) return y
    }
  }

  // Unrolls the Batches in a response
  // NOTE when reading backwards, the events are emitted in reverse Index order to suit the takeWhile consumption
  const mapPage = (
    direction: Direction,
    minIndex: number | undefined,
    maxIndex: number | undefined,
    maxRequests: number | undefined,
    i: number,
    batches: Batch[],
  ): [Event[], Position | undefined] => {
    if (maxRequests != null && i >= maxRequests) throw new Error("Batch limit exceeded")
    const unwrapBatch = (x: Batch) => {
      const result = Batch.enumEvents(minIndex, maxIndex, x)
      if (direction === Direction.Backward) return result.reverse()
      return result
    }
    const events = batches.flatMap(unwrapBatch)
    const maybePosition = tryPick(batches, Position.tryFromBatch)
    return [events, maybePosition]
  }

  type ScanResult<Event> = {
    found: boolean
    minIndex: number
    next: number
    maybeTipPos?: Position
    events: Event[]
  }

  export function scanTip<E>(
    tryDecode: TryDecode<E>,
    isOrigin: (ev: E) => boolean,
    tip: Tip.LoadedTip,
  ): ScanResult<E> {
    const items: E[] = []
    const isOrigin_ = (ev: ITimelineEvent<Buffer>) => {
      const x = tryDecode(ev)
      if (x == undefined) return false
      items.unshift(x)
      return isOrigin(x)
    }
    let found = false
    for (let i = tip.events.length - 1; i >= 0; i--) {
      const ev = tip.events[i]
      if (isOrigin_(ev)) {
        found = true
        break
      }
    }

    return {
      found,
      maybeTipPos: tip.position,
      minIndex: tip.baseIndex,
      next: Position.toIndex(tip.position) + 1,
      events: items,
    }
  }

  export async function scan<E>(
    table: StoreTable,
    stream: string,
    consistentRead: boolean,
    maxItems: number,
    maxRequests: number | undefined,
    direction: Direction,
    tryDecode: TryDecode<E>,
    isOrigin: (ev: E) => boolean,
    minIndex: number | undefined,
    maxIndex: number | undefined,
  ): Promise<ScanResult<E> | undefined> {
    let found = false
    let pagesCount = 0
    let batchCount = 0
    let maybeTipPos: Position | undefined = undefined
    const events: [Event, E | undefined][] = []

    for await (const batches of mkQuery(
      table,
      stream,
      consistentRead,
      maxItems,
      direction,
      minIndex,
      maxIndex,
    )) {
      const [batchEvents, maybePos] = mapPage(
        direction,
        minIndex,
        maxIndex,
        maxRequests,
        pagesCount,
        batches,
      )
      if (maybeTipPos == null) maybeTipPos = maybePos
      pagesCount++
      batchCount += batches.length
      for (const x of batchEvents) {
        const decoded = tryDecode(Event.toTimelineEvent(x))
        events.push([x, decoded])
        if (decoded && isOrigin(decoded)) {
          found = true
          break
        }
      }
      if (found) break
    }
    trace.getActiveSpan()?.setAttributes({
      [Tags.batches]: batchCount,
      [Tags.pages]: pagesCount,
      [Tags.loaded_count]: events.length,
    })

    const decoded =
      direction === Direction.Forward
        ? keepMap(events, (x) => x[1])
        : keepMapRev(events, (x) => x[1])
    const minMax = events.reduce(
      (acc, [x]): [number, number] => {
        if (acc == null) return [x.i, x.i]
        return [x.i < acc[0] ? x.i : acc[0], x.i > acc[1] ? x.i : acc[1]]
      },
      undefined as [number, number] | undefined,
    )
    // const version = maybeTipPos?.index ?? (minMax ? minMax[1] + 1 : 0n)
    if (minMax)
      return { found, minIndex: minMax[0], next: minMax[1] + 1, maybeTipPos, events: decoded }
    if (!minMax && maybeTipPos)
      return {
        found,
        minIndex: maybeTipPos.index,
        next: maybeTipPos.index,
        maybeTipPos,
        events: [],
      }
    return undefined
  }

  export async function* walkLazy<E>(
    table: StoreTable,
    stream: string,
    maxItems: number,
    maxRequests: number | undefined,
    tryDecode: TryDecode<E>,
    isOrigin: (v: E) => boolean,
    direction: Direction,
    minIndex?: number,
    maxIndex?: number,
  ): AsyncIterable<E[]> {
    const allEvents = []
    let i = 0
    const query = mkQuery(table, stream, false, maxItems, direction, minIndex, maxIndex)
    for await (const batches of query) {
      if (maxRequests && i + 1 >= maxRequests) throw new Error("Batch limit exceeded")
      const [events] = mapPage(direction, minIndex, maxIndex, maxRequests, i, batches)
      allEvents.push(...events)
      const acc: E[] = []
      let found = false
      for (const x of events) {
        const decoded = tryDecode(Event.toTimelineEvent(x))
        if (!decoded) continue
        acc.push(decoded)
        if (isOrigin(decoded)) {
          found = true
          break
        }
      }
      yield acc
      i++
      if (found) break
    }
  }

  export async function load<E>(
    minIndex: number | undefined,
    maxIndex: number | undefined,
    tip: ScanResult<E> | undefined,
    primary: (a: number | undefined, b: number | undefined) => Promise<ScanResult<E> | undefined>,
    fallback:
      | boolean
      | ((a: number | undefined, b: number | undefined) => Promise<ScanResult<E> | undefined>),
  ): Promise<[Position | undefined, E[]]> {
    const minI = minIndex ?? 0n
    if (tip?.found && tip.maybeTipPos) return [tip.maybeTipPos, tip.events]
    if (tip?.maybeTipPos && tip.minIndex <= minI) return [tip.maybeTipPos, tip.events]

    const i = tip?.minIndex ?? maxIndex
    let events = tip?.events ?? []
    const primary_ = await primary(minIndex, i)
    events = primary_ ? primary_.events.concat(events) : events
    const tipPos = tip?.maybeTipPos ?? primary_?.maybeTipPos
    // origin found in primary, no need to look in fallback
    if (primary_?.found) return [tipPos, events]
    // primary had required earliest event Index, no need to look at fallback
    if (primary_ && primary_.minIndex <= minI) return [tipPos, events]
    // initial load where no documents present in stream
    if (!primary_ && tip == null) return [tipPos, events]
    if (typeof fallback === "boolean") {
      const allowMissing = fallback
      if (allowMissing) return [tipPos, events]
      throw new Error("Origin event not found; no Archive Table supplied")
    }
    const fb = await fallback(minIndex, primary_?.minIndex ?? maxIndex)
    const eventsWithFallback = fb?.events.concat(events) ?? events
    return [tipPos, eventsWithFallback]
  }
}

type Token = { pos?: Position }
namespace Token {
  export const create = (pos?: Position): StreamToken => {
    const [v, b] = Position.toVersionAndStreamBytes(pos)
    return { value: { pos }, version: BigInt(v), bytes: BigInt(b) }
  }
  export const empty = create()
  export const unpack = (token: StreamToken): Position | undefined => (token.value as any)?.pos

  export const supersedes = (at: StreamToken, bt: StreamToken) => {
    const a = unpack(at)
    const b = unpack(bt)
    if (a && b) return a.index > b.index || a.etag !== b.etag
    return Boolean(!a && b)
  }
}

export type QueryOptions = {
  maxItems: number
  maxRequests?: number
  ignoreMissing: boolean
}

export namespace QueryOptions {
  const defaults: QueryOptions = {
    maxItems: 32,
    ignoreMissing: false,
  }

  export const create = (opts: Partial<QueryOptions>): QueryOptions => ({
    ...defaults,
    ...opts,
  })
}

type TipOptions = {
  maxEvents?: number
  maxBytes: number
  maxEventBytes: number
}

export namespace TipOptions {
  const defaults: TipOptions = {
    maxBytes: 32 * 1024,
    maxEventBytes: 32 * 1024,
  }
  export const create = (opts: Partial<TipOptions>): TipOptions => ({
    ...defaults,
    ...opts,
  })
}

type LoadFromTokenResult<Event> =
  | { type: "Unchanged" }
  | { type: "Found"; token: StreamToken; events: Event[] }

type InternalSyncResult = { type: "Written"; token: StreamToken } | { type: "ConflictUnknown" }

class StoreClient {
  constructor(
    private readonly table: StoreTable,
    private readonly fallback: StoreTable | undefined,
    private readonly query: QueryOptions,
    private readonly tip: TipOptions,
  ) {}

  private loadTip(stream: string, consistentRead: boolean, pos?: Position) {
    return Tip.tryLoad(this.table, stream, consistentRead, pos)
  }

  async read<E>(
    stream: string,
    consistentRead: boolean,
    direction: Direction,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    minIndex?: number,
    maxIndex?: number,
    tipRet?: Tip.LoadedTip,
  ): Promise<[StreamToken, E[]]> {
    const tip = tipRet && Query.scanTip(tryDecode, isOrigin, tipRet)
    maxIndex = maxIndex ?? (tip ? Batch.tipMagicI : undefined)
    const walk =
      (table: StoreTable) => (minIndex: number | undefined, maxIndex: number | undefined) =>
        Query.scan(
          table,
          stream,
          consistentRead,
          this.query.maxItems,
          this.query.maxRequests,
          direction,
          tryDecode,
          isOrigin,
          minIndex,
          maxIndex,
        )
    const walkFallback = this.fallback == null ? this.query.ignoreMissing : walk(this.fallback)
    const [pos, events] = await Query.load(minIndex, maxIndex, tip, walk(this.table), walkFallback)
    trace.getActiveSpan()?.setAttribute(Tags.loaded_count, events.length)
    return [Token.create(pos), events]
  }

  async load<E>(
    stream: string,
    maybePos: Position | undefined,
    consistentRead: boolean,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    checkUnfolds: boolean,
  ): Promise<[StreamToken, E[]]> {
    const span = trace.getActiveSpan()
    span?.setAttribute(Tags.load_method, "BatchBackward")
    if (!checkUnfolds)
      return this.read(stream, consistentRead, Direction.Backward, tryDecode, isOrigin)
    const res = await this.loadTip(stream, consistentRead, maybePos)
    switch (res.type) {
      case "NotFound":
        return [Token.empty, []]
      case "NotModified":
        throw new Error("Not applicable")
      case "Found":
        return this.read(
          stream,
          consistentRead,
          Direction.Backward,
          tryDecode,
          isOrigin,
          undefined,
          undefined,
          res.data,
        )
    }
  }
  async getPosition(stream: string, pos?: Position) {
    const res = await this.loadTip(stream, false, pos)
    switch (res.type) {
      case "NotFound":
        return Token.empty
      case "NotModified":
        return Token.create(pos)
      case "Found":
        return Token.create(res.data.position)
    }
  }

  async reload<E>(
    stream: string,
    maybePos: Position | undefined,
    consistentRead: boolean,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    preview?: Tip.LoadedTip,
  ): Promise<LoadFromTokenResult<E>> {
    const read = async (tipContent: Tip.LoadedTip): Promise<LoadFromTokenResult<E>> => {
      const res = await this.read(
        stream,
        consistentRead,
        Direction.Backward,
        tryDecode,
        isOrigin,
        Position.toIndex(maybePos),
        undefined,
        tipContent,
      )
      return { type: "Found", token: res[0], events: res[1] }
    }
    if (preview != null) return read(preview)
    const res = await this.loadTip(stream, consistentRead, maybePos)
    switch (res.type) {
      case "NotFound":
        return { type: "Found", token: Token.empty, events: [] }
      case "NotModified":
        return { type: "Unchanged" }
      case "Found":
        return read(res.data)
    }
  }

  async sync(
    stream: string,
    pos: Position | undefined,
    exp: (p?: Position) => Sync.ExpectedVersion,
    n_: number,
    eventsEncoded: IEventData<Buffer>[],
    unfoldsEncoded: IEventData<Buffer>[],
  ): Promise<InternalSyncResult> {
    const res = await Sync.handle(
      this.tip.maxEvents,
      this.tip.maxBytes,
      this.tip.maxEventBytes,
      this.table,
      stream,
      pos,
      exp,
      n_,
      eventsEncoded,
      unfoldsEncoded,
    )
    switch (res.type) {
      case "ConflictUnknown":
        trace.getActiveSpan()?.addEvent("Conflict")
        return { type: "ConflictUnknown" }
      case "Written":
        return {
          type: "Written",
          token: Token.create(
            Position.fromElements(
              stream,
              res.predecessorBytes,
              n_,
              res.events,
              res.unfolds,
              res.etag,
            ),
          ),
        }
    }
  }
}
export type MapUnfolds<E, S> =
  | { type: "None" }
  | { type: "Unfold"; unfold: (events: E[], state: S) => E[] }
  | { type: "Transmute"; transmute: (events: E[], state: S) => [E[], E[]] }

class StoreCategory<E, S, C> implements IReloadableCategory<E, S, C> {
  constructor(
    private readonly store: StoreClient,
    private readonly categoryName: string,
    private readonly codec: ICodec<E, Buffer, C>,
    private readonly fold: (state: S, events: E[]) => S,
    private readonly initial: S,
    private readonly isOrigin: (e: E) => boolean,
    private readonly checkUnfolds: boolean,
    private readonly mapUnfolds: MapUnfolds<E, S>,
  ) {}

  private streamName(x: StreamId) {
    return StreamName.create(this.categoryName, x)
  }

  async load(
    streamId: StreamId,
    _maxStaleMs: number,
    requireLeader: boolean,
  ): Promise<TokenAndState<S>> {
    const streamName = this.streamName(streamId)
    const [token, events] = await this.store.load(
      streamName,
      undefined,
      requireLeader,
      this.codec.tryDecode,
      this.isOrigin,
      this.checkUnfolds,
    )

    return { token, state: this.fold(this.initial, events) }
  }
  async sync(
    streamId: StreamId,
    context: C,
    originToken: StreamToken,
    originState: S,
    events: E[],
  ): Promise<SyncResult<S>> {
    const streamName = this.streamName(streamId)
    const newState = this.fold(originState, events)
    const pos = Token.unpack(originToken)
    let exp: (pos?: Position) => number | string
    let unfoldsEncoded: IEventData<Buffer>[] = []
    let eventsEncoded: IEventData<Buffer>[] = []
    const encode = (evs: E[]) => evs.map((ev) => this.codec.encode(ev, context))
    switch (this.mapUnfolds.type) {
      case "None":
        exp = Position.toIndex
        eventsEncoded = encode(events)
        break
      case "Unfold":
        exp = Position.toIndex
        eventsEncoded = encode(events)
        unfoldsEncoded = encode(this.mapUnfolds.unfold(events, originState))
        break
      case "Transmute":
        const [events_, unfolds] = this.mapUnfolds.transmute(events, newState)
        exp = (x) => Position.toEtag(x)!
        events = events_
        eventsEncoded = encode(events_)
        unfoldsEncoded = encode(unfolds)
    }

    const baseVer = Position.toIndex(pos) + events.length
    const res = await this.store.sync(streamName, pos, exp, baseVer, eventsEncoded, unfoldsEncoded)
    switch (res.type) {
      case "ConflictUnknown":
        return {
          type: "Conflict",
          resync: () => this.reload(streamId, true, { token: originToken, state: originState }),
        }
      case "Written":
        return { type: "Written", data: { token: res.token, state: newState } }
    }
  }

  async reload(
    streamId: StreamId,
    requireLeader: boolean,
    t: TokenAndState<S>,
  ): Promise<TokenAndState<S>> {
    const span = trace.getActiveSpan()
    span?.setAttribute(Tags.loaded_from_version, String(Position.toIndex(Token.unpack(t.token))))
    const streamName = this.streamName(streamId)
    const result = await this.store.reload(
      streamName,
      Token.unpack(t.token),
      requireLeader,
      this.codec.tryDecode,
      this.isOrigin,
    )

    switch (result.type) {
      case "Found":
        span?.setAttribute(Tags.loaded_count, result.events.length)
        return { token: result.token, state: this.fold(t.state, result.events) }
      case "Unchanged":
        span?.setAttribute(Tags.loaded_count, 0)
        return t
    }
  }
}

export class DynamoStoreClient {
  public readonly primary: DynamoDB
  public readonly secondary: DynamoDB
  constructor(primary: DynamoDB, secondary?: DynamoDB) {
    this.primary = primary
    this.secondary = secondary ?? primary
  }
}

export class DynamoStoreContext {
  constructor(
    private options: {
      client: DynamoStoreClient
      tableName: string
      tip: TipOptions
      query: QueryOptions
      archiveTableName?: string
    },
  ) {}

  get storeClient() {
    const { tableName, client, tip, query, archiveTableName } = this.options
    const primary = new StoreTable(tableName, client.primary)
    const fallback = archiveTableName
      ? StoreTable.create(archiveTableName, client.secondary)
      : undefined
    return new StoreClient(primary, fallback, query, tip)
  }
}

export type AccessStrategy<E, S> =
  | { type: "Unoptimized" }
  | { type: "LatestKnownEvent" }
  | { type: "Snapshot"; isOrigin: (e: E) => boolean; toSnapshot: (s: S) => E }
  | { type: "MultiSnapshot"; isOrigin: (e: E) => boolean; toSnapshot: (s: S) => E[] }
  | { type: "RollingState"; toSnapshot: (s: S) => E }
  | { type: "Custom"; isOrigin: (e: E) => boolean; transmute: (es: E[], s: S) => [E[], E[]] }
export namespace AccessStrategy {
  export const Unoptimized = (): AccessStrategy<any, any> => ({ type: "Unoptimized" })
  export const LatestKnownEvent = (): AccessStrategy<any, any> => ({ type: "LatestKnownEvent" })
  export const Snapshot = <E, S>(
    isOrigin: (e: E) => boolean,
    toSnapshot: (s: S) => E,
  ): AccessStrategy<E, S> => ({ type: "Snapshot", isOrigin, toSnapshot })
  export const MultiSnapshot = <E, S>(
    isOrigin: (e: E) => boolean,
    toSnapshot: (s: S) => E[],
  ): AccessStrategy<E, S> => ({ type: "MultiSnapshot", isOrigin, toSnapshot })
  export const RollingState = <E, S>(toSnapshot: (s: S) => E): AccessStrategy<E, S> => ({
    type: "RollingState",
    toSnapshot,
  })
  export const Custom = <E, S>(
    isOrigin: (e: E) => boolean,
    transmute: (es: E[], s: S) => [E[], E[]],
  ): AccessStrategy<E, S> => ({ type: "Custom", isOrigin, transmute })
}

export class DynamoStoreCategory {
  static create<E, S, C>(
    context: DynamoStoreContext,
    name: string,
    codec: ICodec<E, Buffer, C>,
    fold: (s: S, es: E[]) => S,
    initial: S,
    caching: ICachingStrategy | undefined,
    access: AccessStrategy<E, S>,
  ): Category<E, S, C> {
    let isOrigin: (e: E) => boolean
    let checkUnfolds = true
    let mapUnfolds: MapUnfolds<E, S>
    switch (access.type) {
      case "Unoptimized":
        isOrigin = () => false
        checkUnfolds = false
        mapUnfolds = { type: "None" }
        break
      case "LatestKnownEvent":
        isOrigin = () => true
        mapUnfolds = { type: "Unfold", unfold: (es: E[], _s: S) => [es[es.length - 1]] }
        break
      case "Snapshot":
        isOrigin = access.isOrigin
        mapUnfolds = { type: "Unfold", unfold: (_es: E[], s: S) => [access.toSnapshot(s)] }
        break
      case "MultiSnapshot":
        isOrigin = access.isOrigin
        mapUnfolds = { type: "Unfold", unfold: (_es: E[], s: S) => access.toSnapshot(s) }
        break
      case "RollingState":
        isOrigin = () => true
        mapUnfolds = { type: "Unfold", unfold: (_: E[], s: S) => [access.toSnapshot(s)] }
        break
      case "Custom":
        isOrigin = access.isOrigin
        mapUnfolds = { type: "Transmute", transmute: access.transmute }
    }

    const inner = new StoreCategory(
      context.storeClient,
      name,
      codec,
      fold,
      initial,
      isOrigin,
      checkUnfolds,
      mapUnfolds,
    )
    const category = CachingCategory.apply(name, inner, caching)
    const empty: TokenAndState<S> = { token: Token.empty, state: initial }
    return new Category(category, empty)
  }
}
