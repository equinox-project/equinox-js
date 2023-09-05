import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { EventsTable } from "./table"
import { IndexerLambda } from "./indexer-lambda"

export class SrcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const events = new EventsTable(this, "events")
    const index = new EventsTable(this, "events_index")
    
    const indexer = new IndexerLambda(this, "indexer", events.table, index.table)
  }
}
