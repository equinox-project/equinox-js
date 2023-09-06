import { Construct } from "constructs"
import * as cdk from "aws-cdk-lib"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

export class IndexerLambda extends Construct {
  constructor(
    scope: Construct,
    id: string,
    eventsTable: dynamodb.Table,
    indexTable: dynamodb.Table,
  ) {
    super(scope, id)

    const fn = new NodejsFunction(this, "IndexerLambda", {
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: "./node_modules/@equinox-js/dynamo-store-indexer-lambda/src/index.ts",
      handler: "handler",
      environment: {
        TABLE_NAME: eventsTable.tableName,
        INDEX_TABLE_NAME: indexTable.tableName,
      },
    })

    eventsTable.grantReadData(fn)
    eventsTable.grantFullAccess(fn)
    indexTable.grantReadWriteData(fn)

    const batchSize = new cdk.CfnParameter(this, "BatchSize", {
      type: "Number",
      description: "Batch size for the indexer lambda",
      default: 1000,
    })

    fn.addEventSourceMapping("EventSource", {
      eventSourceArn: eventsTable.tableStreamArn,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: batchSize.valueAsNumber,
    })
  }
}
