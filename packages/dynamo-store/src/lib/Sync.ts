import { arrayBytes as eventArrayBytes, bytes as eventBytes, Event } from "./Event"
import { arrayBytes as unfoldArrayBytes, Unfold } from "./Unfold"
import { eventsToSchema, Schema, unfoldsToSchema } from "./Schema"
import { tableKeyForStreamTip, tipMagicI } from "./Batch"
import type { DynamoExpr } from "./Container"
import { Container, reportRU, reportRUs } from "./Container"
import { PutCommand, TransactWriteCommand, TransactWriteCommandInput, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { randomUUID } from "crypto"
import { AttributeValue, ReturnConsumedCapacity } from "@aws-sdk/client-dynamodb"
import { flatten, Position } from "./Position"
import { StreamEvent } from "@equinox-js/core"
import { EncodedBody, toInternal } from "./EncodedBody"

enum ReqType {
  Append,
  Calve,
}
type Req =
  | { type: ReqType.Append; tipWasEmpty: boolean; events: Event[] }
  | {
      type: ReqType.Calve
      calfEvents: Event[]
      updatedTipEvents: Event[]
      freshEventsCount: number
    }

export type ExpectedVersion = bigint | string

type ItemType<T> = T extends Array<infer P> ? P : never

type TransactWriteItem = ItemType<TransactWriteCommandInput["TransactItems"]>
const updateTip = (table: string, stream: string, expr: DynamoExpr): TransactWriteItem => {
  return {
    Update: {
      TableName: table,
      ConditionExpression: expr.condition,
      Key: tableKeyForStreamTip(stream),
      UpdateExpression: expr.text,
      ExpressionAttributeValues: expr.values,
    },
  }
}

const putItemIfNotExists = (table: string, item: Schema): TransactWriteItem => ({
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
  n_: bigint,
  etag_: string | undefined
): TransactWriteItem[] {
  const u = unfoldsToSchema(u_)
  const [replaceTipEvents, tipA, [tipC, tipE], maybeCalf] = (() => {
    switch (req.type) {
      case ReqType.Append: {
        const replaceTipEvents = req.tipWasEmpty && req.events.length !== 0
        return [replaceTipEvents, req.events.length, eventsToSchema(req.events), undefined] as const
      }
      case ReqType.Calve: {
        const tipA = Math.min(req.updatedTipEvents.length, req.freshEventsCount)
        const calfA = req.freshEventsCount - tipA
        const [calfC, calfE] = eventsToSchema(req.calfEvents)
        const tipIndex = n_ - BigInt(req.updatedTipEvents.length)
        const calfIndex = tipIndex - BigInt(req.calfEvents.length)
        const calf: Schema = {
          p: { S: stream },
          i: { N: String(calfIndex) },
          a: { N: String(calfA) },
          u: { L: [] },
          c: { L: calfC },
          e: { L: calfE },
          n: { N: String(tipIndex) },
        }
        return [true, tipA, eventsToSchema(req.updatedTipEvents), calf] as const
      }
    }
  })()
  const genFreshTipItem = (): Schema => {
    const schema: Schema = {
      p: { S: stream },
      i: { N: String(tipMagicI) },
      a: { N: String(tipA) },
      b: { N: String(b_) },
      u: { L: u },
      n: { N: String(n_) },
      e: { L: tipE },
      c: { L: tipC },
    }
    if (etag_) schema.etag = { S: etag_ }
    return schema
  }
  const updateTipIf = (condExpr: string, condValues: Record<string, AttributeValue>) => {
    const updateExpression: DynamoExpr = replaceTipEvents
      ? {
          text: "SET a = :tipA, b = :b, etag = :etag, u = :u, n = :n, e = :tipE, c = :tipC",
          condition: condExpr,
          values: Object.assign(
            {
              ...condValues,
              ":tipA": { N: String(tipA) },
              ":b": { N: String(b_) },
              ":u": { L: u },
              ":n": { N: String(n_) },
              ":tipE": { L: tipE },
              ":tipC": { L: tipC },
            },
            // nasty trick so typescript doesn't think :etag is of type `string | undefined`
            etag_ ? { ":etag": { S: etag_ } } : ({} as { ":etag": never })
          ),
        }
      : tipE.length === 0
      ? {
          text: "SET a = :tipA, b = :b, etag = :etag, u = :u",
          condition: condExpr,
          values: Object.assign(
            {
              ...condValues,
              ":tipA": { N: "0" },
              ":b": { N: String(b_) },
              ":u": { L: u },
            },
            etag_ ? { ":etag": { S: etag_ } } : ({} as { ":etag": never })
          ),
        }
      : {
          text: "SET a = :tipA, b = :b, etag = :etag, u = :u, n = :n, e = list_append(e, :tipE), c = list_append(c, :tipC)",
          condition: condExpr,
          values: Object.assign(
            {
              ...condValues,
              ":tipA": { N: String(tipA) },
              ":b": { N: String(b_) },
              ":u": { L: u },
              ":n": { N: String(n_) },
              ":tipE": { L: tipE },
              ":tipC": { L: tipC },
            },
            etag_ ? { ":etag": { S: etag_ } } : ({} as { ":etag": never })
          ),
        }
    return updateTip(table, stream, updateExpression)
  }

  const tipUpdate =
    exp == null || exp === 0n
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

async function transact(
  container: Container,
  stream: string,
  req: Req,
  unfold: Unfold[],
  exp: ExpectedVersion,
  bytes: number,
  n: bigint
): Promise<DynamoSyncResult> {
  const etag_ = randomUUID()
  const actions = generateRequests(container.tableName, stream, req, unfold, exp, bytes, n, etag_)
  try {
    if (actions.length === 1 && actions[0].Put != null) {
      await container.context
        .putItem({
          ...actions[0].Put,
          ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
        })
        .then(reportRU)
    } else if (actions.length === 1 && actions[0].Update != null) {
      await container.context
        .updateItem({
          ...actions[0].Update,
          ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
        })
        .then(reportRU)
    } else {
      await container.context
        .transactWriteItems({
          TransactItems: actions,
          ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
        })
        .then(reportRUs)
    }
    return { type: "Written", etag: etag_ }
  } catch (err: any) {
    console.error(err)
    return { type: "ConflictUnknown" }
  }
}

const maxDynamoDbItemSize = 400 * 1024

type Result = { type: "ConflictUnknown" } | { type: "Written"; etag: string; predecessorBytes: number; events: Event[]; unfolds: Unfold[] }

export async function handle(
  maxEvents: number | undefined,
  maxBytes: number,
  container: Container,
  stream: string,
  pos: Position | undefined,
  exp: (p?: Position) => ExpectedVersion,
  n_: bigint,
  streamEvents: StreamEvent<EncodedBody>[],
  streamUnfolds: StreamEvent<EncodedBody>[]
): Promise<Result> {
  const baseIndex = n_ - BigInt(streamEvents.length)
  const events = streamEvents.map(
    (e, i): Event => ({
      i: baseIndex + BigInt(i),
      t: new Date(),
      c: e.type,
      d: toInternal(e.data),
      m: toInternal(e.meta),
    })
  )
  const unfolds = streamUnfolds.map(
    (x, i): Unfold => ({
      i: baseIndex + BigInt(i),
      t: new Date(),
      c: x.type,
      d: toInternal(x.data),
      m: toInternal(x.meta),
    })
  )
  if (events.length === 0 && unfolds.length === 0) throw new Error("Must write either events or unfolds")
  const cur = flatten(pos)
  const evtOverflow = maxEvents ? events.length + cur.events.length > maxEvents : false
  let req: Req
  let predecessorBytes: number
  let tipEvents: Event[]
  if (evtOverflow || cur.baseBytes + eventArrayBytes(events) + unfoldArrayBytes(unfolds) > maxBytes) {
    const calfEvents: Event[] = []
    const updatedTipEvents: Event[] = []
    let calfFull = false
    let calfSize = 1024
    for (const e of cur.events.concat(events)) {
      const nextCalfSize = eventBytes(e) + calfSize
      if (!calfFull && nextCalfSize < maxDynamoDbItemSize) {
        calfSize = nextCalfSize
        calfEvents.push(e)
        continue
      }
      calfFull = true
      updatedTipEvents.push(e)
    }
    req = { type: ReqType.Calve, calfEvents, updatedTipEvents, freshEventsCount: events.length }
    predecessorBytes = cur.calvedBytes + eventArrayBytes(calfEvents)
    tipEvents = updatedTipEvents
  } else {
    req = { type: ReqType.Append, events, tipWasEmpty: cur.events.length === 0 }
    predecessorBytes = cur.calvedBytes
    tipEvents = cur.events.concat(events)
  }
  const res = await transact(container, stream, req, unfolds, exp(pos), predecessorBytes, n_)
  switch (res.type) {
    case "ConflictUnknown":
      return { type: "ConflictUnknown" }
    case "Written":
      return { type: "Written", etag: res.etag, predecessorBytes, events: tipEvents, unfolds }
  }
}
