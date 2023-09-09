import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import { Construct } from "constructs"

interface BaseOptions {
  tableName: string
  stream?: dynamodb.StreamViewType
  tableClass?: dynamodb.TableClass
}
interface ProvisionedOptions {
  billingMode: dynamodb.BillingMode.PROVISIONED
  writeCapacity: number
  readCapacity: number
}
interface OnDemandOptions {
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
}

type ThroughputOptions = ProvisionedOptions | OnDemandOptions
export type TableOptions = BaseOptions & ThroughputOptions

export class EventsTable extends Construct {
  table: dynamodb.Table
  constructor(scope: Construct, id: string, options: TableOptions) {
    super(scope, id)

    this.table = new dynamodb.Table(this, "EventsTable", {
      tableName: options.tableName,
      partitionKey: {
        name: "p",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "i",
        type: dynamodb.AttributeType.NUMBER,
      },
      billingMode: options.billingMode,
      tableClass: options.tableClass,
      writeCapacity:
        options.billingMode === dynamodb.BillingMode.PROVISIONED
          ? options.writeCapacity
          : undefined,
      readCapacity:
        options.billingMode === dynamodb.BillingMode.PROVISIONED ? options.readCapacity : undefined,
      stream: options.stream,
    })
  }
}
