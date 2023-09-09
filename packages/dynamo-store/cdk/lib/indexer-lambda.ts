import { Construct } from "constructs"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as path from "path"

export interface LambdaOptions {
  eventsTable: dynamodb.Table
  indexTable: dynamodb.Table
  batchSize?: number
}

export class IndexerLambda extends Construct {
  constructor(scope: Construct, id: string, options: LambdaOptions) {
    super(scope, id)

    const fn = new NodejsFunction(this, "IndexerLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: require.resolve("@equinox-js/dynamo-store-indexer-lambda"),
      handler: "handler",
      environment: {
        TABLE_NAME: options.eventsTable.tableName,
        INDEX_TABLE_NAME: options.indexTable.tableName,
      },
    })

    options.eventsTable.grantReadData(fn)
    options.eventsTable.grantStreamRead(fn)
    options.eventsTable.grantFullAccess(fn)
    options.indexTable.grantReadWriteData(fn)

    fn.addEventSourceMapping("EventSource", {
      eventSourceArn: options.eventsTable.tableStreamArn,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: options.batchSize || 1000,
    })
  }
}
