import * as cdk from "aws-cdk-lib"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import { Construct } from "constructs"
import { BillingMode } from "aws-cdk-lib/aws-dynamodb"
export class EventsTable extends Construct {
  table: dynamodb.Table
  constructor(scope: Construct, id: string, isIndex: boolean) {
    super(scope, id)

    const tableName = new cdk.CfnParameter(this, "TableName", {
      type: "String",
      description: "The name of the DynamoDB table that will store events",
      default: id,
    })

    const billingMode = new cdk.CfnParameter(this, "BillingMode", {
      type: "String",
      description: "The billing mode for the DynamoDB table",
      default: dynamodb.BillingMode.PAY_PER_REQUEST,
    })
    const tableClass = new cdk.CfnParameter(this, "TableClass", {
      type: "String",
      description: "The table class of the events table",
      default: dynamodb.TableClass.STANDARD,
    })
    const writeCapacity = new cdk.CfnParameter(this, "WriteCapacity", {
      type: "Number",
      description:
        "The write capacity for the DynamoDB table (required if billing mode = PROVISIONED)",
      default: 0,
    })
    const readCapacity = new cdk.CfnParameter(this, "ReadCapacity", {
      type: "Number",
      description:
        "The read capacity for the DynamoDB table (required if billing mode = PROVISIONED)",
      default: 0,
    })
    const streamViewType = new cdk.CfnParameter(this, "StreamViewType", {
      type: "String",
      description: "The stream view type for the DynamoDB table",
      default: dynamodb.StreamViewType.NEW_IMAGE,
    })

    this.table = new dynamodb.Table(this, "EventsTable", {
      tableName: tableName.valueAsString,
      partitionKey: {
        name: "p",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "i",
        type: dynamodb.AttributeType.NUMBER,
      },
      billingMode: billingMode.valueAsString as dynamodb.BillingMode,
      tableClass: tableClass.valueAsString as dynamodb.TableClass,
      writeCapacity:
        billingMode.valueAsString === BillingMode.PROVISIONED
          ? writeCapacity.valueAsNumber
          : undefined,
      readCapacity:
        billingMode.valueAsString === BillingMode.PROVISIONED
          ? readCapacity.valueAsNumber
          : undefined,
      stream: isIndex
        ? undefined
        : (streamViewType.valueAsString as dynamodb.StreamViewType) || undefined,
    })
  }
}
