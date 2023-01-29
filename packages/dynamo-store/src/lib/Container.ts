import { Batch, isTip, tableKeyForStreamTip } from "./Batch"
import { AttributeValue, ConsumedCapacity, DynamoDB, ReturnConsumedCapacity, ReturnValue } from "@aws-sdk/client-dynamodb"
import { schemaToBatch } from "./Schema"
import { metrics, SpanKind, trace } from "@opentelemetry/api"
import { tracer } from "./Tracing"

const counter = metrics.getMeter("@equinox-js/dynamo-store").createCounter("consumed_capacity")

export const reportRU = <T extends { ConsumedCapacity?: ConsumedCapacity }>(response: T): T => {
  const cost = response.ConsumedCapacity?.CapacityUnits ?? 0
  trace.getActiveSpan()?.setAttribute("eqx.ru", cost)
  counter.add(cost)
  return response
}
export const reportRUs = <T extends { ConsumedCapacity?: ConsumedCapacity[] }>(response: T): T => {
  for (const cap of response.ConsumedCapacity ?? []) {
    counter.add(cap.CapacityUnits ?? 0)
  }
  return response
}

type BatchIndices = { isTip: boolean; index: bigint; n: bigint }

export type DynamoExpr = {
  text: string
  condition?: string
  values: Record<string, AttributeValue>
}

const attributesOfList = (l: [string, AttributeValue | undefined][]) => {
  const result: Record<string, AttributeValue> = {}
  for (let i = 0; i < l.length; ++i) {
    const key = l[i][0]
    const value = l[i][1]
    if (value != null) result[key] = value
  }
  return result
}

export class Container {
  constructor(public readonly tableName: string, public readonly context: DynamoDB) {}

  async tryGetTip(stream: string, consistentRead: boolean): Promise<Batch | undefined> {
    const pk = tableKeyForStreamTip(stream)
    const result = await this.context
      .getItem({ Key: pk, TableName: this.tableName, ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL, ConsistentRead: consistentRead })
      .then(reportRU)

    if (result.Item) {
      return schemaToBatch(result.Item as any)
    }
  }

  async tryUpdateTip(stream: string, expr: DynamoExpr): Promise<Batch | undefined> {
    const pk = tableKeyForStreamTip(stream)
    const result = await this.context
      .updateItem({
        TableName: this.tableName,
        Key: pk,
        UpdateExpression: expr.text,
        ConditionExpression: expr.condition,
        ExpressionAttributeValues: expr.values,
        ReturnValues: ReturnValue.ALL_NEW,
      })
      .then(reportRU)
    if (result.Attributes) return schemaToBatch(result.Attributes as any)
  }

  queryBatches(stream: string, consistentRead: boolean, minN: bigint | undefined, maxI: bigint | undefined, backwards: boolean, batchSize: number) {
    const send = (le?: Record<string, any>) =>
      tracer.startActiveSpan(
        "QueryBatch",
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "eqx.direction": backwards ? "Backwards" : "Forwards",
            "eqx.batch_size": batchSize,
            "eqx.table_name": this.tableName,
            "eqx.stream_name": stream,
            "eqx.require_leader": consistentRead,
            "eqx.min_n": minN ? String(minN) : undefined,
            "eqx.max_i": maxI ? String(maxI) : undefined,
          },
        },
        (span) =>
          this.context
            .query({
              TableName: this.tableName,
              KeyConditionExpression: maxI == null ? "p = :p" : "p = :p AND i < :maxI",
              FilterExpression: minN == null ? undefined : "n > :minN",
              ExpressionAttributeValues: attributesOfList([
                [":p", { S: stream }],
                [":maxI", maxI == null ? undefined : { N: String(maxI) }],
                [":minN", minN == null ? undefined : { N: String(minN) }],
              ]),
              Limit: batchSize,
              ExclusiveStartKey: le,
              ScanIndexForward: !backwards,
              ConsistentRead: consistentRead,
              ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
            })
            .then(reportRU)
            .finally(() => span.end())
      )
    async function* aux(i: number, le?: Record<string, any>): AsyncIterable<[number, Batch[]]> {
      const result = await send(le)
      yield [i, result.Items?.map((x) => schemaToBatch(x as any)) ?? []]
      if (result.LastEvaluatedKey) yield* aux(i + 1, result.LastEvaluatedKey)
    }
    return aux(0)
  }

  async queryIAndNOrderByNAscending(stream: string, maxItems: number) {
    const send = (le?: Record<string, any>) =>
      this.context
        .query({
          TableName: this.tableName,
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
        .then(reportRU)
    async function* aux(i: number, le?: Record<string, any>): AsyncGenerator<[number, BatchIndices[]], void, unknown> {
      const result = await send(le)
      const items = result.Items?.map((x_): BatchIndices => {
        const x = x_ as Projected
        const i = BigInt(x.i.N)
        const c = x.c.L.map((x) => x.S)
        const n = BigInt(x.n.N)
        return { isTip: isTip(i), index: n - BigInt(c.length), n }
      })
      yield [i, items ?? []]
      if (result.LastEvaluatedKey) yield* aux(i + 1, result.LastEvaluatedKey)
    }
    return aux(0)
  }

  async deleteItem(stream: string, i: bigint) {
    await this.context
      .deleteItem({
        TableName: this.tableName,
        Key: { p: { S: stream }, i: { N: String(i) } },
        ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL,
      })
      .then(reportRU)
  }
}

type Projected = {
  i: { N: string }
  c: { L: { S: string }[] }
  n: { N: string }
}
