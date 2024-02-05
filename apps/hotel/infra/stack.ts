import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { DynamoStore } from "@equinox-js/dynamo-store-cdk"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

export class HotelStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    new DynamoStore(this, "HotelStack", {
      eventsTable: {
        tableName: "hotel_events",
        tableClass: dynamodb.TableClass.STANDARD,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        stream: dynamodb.StreamViewType.NEW_IMAGE,
      },
      indexTable: {
        tableName: "hotel_events_index",
        tableClass: dynamodb.TableClass.STANDARD,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    })
  }
}
