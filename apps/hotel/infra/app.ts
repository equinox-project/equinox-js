import * as cdk from "aws-cdk-lib"
import { HotelStack } from "./stack.js"

const app = new cdk.App()
new HotelStack(app, "HotelStack")
