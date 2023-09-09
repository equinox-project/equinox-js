import { Construct } from 'constructs';
import { EventsTable, TableOptions } from './table';
import { IndexerLambda } from './indexer-lambda';

export interface CdkProps {
  eventsTable: TableOptions
  indexTable: TableOptions
  lambdaBatchSize?: number 
  // Define construct properties here
}

export class DynamoStore extends Construct {

  constructor(scope: Construct, id: string, props: CdkProps) {
    super(scope, id);

    const eventsTable = new EventsTable(this, "EventsTable", props.eventsTable)
    const indexTable = new EventsTable(this, "IndexTable", props.indexTable)
    const lambda = new IndexerLambda(this, "IndexerLambda", {
      eventsTable: eventsTable.table,
      indexTable: indexTable.table,
      batchSize: props.lambdaBatchSize
    })
  }
}
