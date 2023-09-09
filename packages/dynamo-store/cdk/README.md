# @equinox-js/dynamo-store-cdk 

## Usage

```ts
import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { DynamoStore } from "@equinox-js/dynamo-store-cdk"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    new DynamoStore(this, "DynamoStoreStack", {
      eventsTable: {
        tableName: "events",
        tableClass: dynamodb.TableClass.STANDARD,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        stream: dynamodb.StreamViewType.NEW_IMAGE,
      },
      indexTable: {
        tableName: "events_index",
        tableClass: dynamodb.TableClass.STANDARD,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
      lambdaBatchSize: 1000,
    })
  }
}
```

## Contributing

You should explore the contents of this project. It demonstrates a CDK Construct Library that includes a construct (`Cdk`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The construct defines an interface (`CdkProps`) to configure the visibility timeout of the queue.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
