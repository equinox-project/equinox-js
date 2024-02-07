import Sdk from "@opentelemetry/sdk-node"
// @ts-ignore
import { PrettyConsoleProcessor } from "opentelemetry-exporter-console-pretty"
import pg from "@opentelemetry/instrumentation-pg"
import http from "@opentelemetry/instrumentation-http"
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api"

export const sdk = new Sdk.NodeSDK({
  spanProcessor: new PrettyConsoleProcessor(),
  instrumentations: [
    new pg.PgInstrumentation({
      enhancedDatabaseReporting: true,
      requireParentSpan: true,
      responseHook: (span, response) => {
        span.setAttribute("db.row_count", response.data.rowCount)
      },
    }),
    new http.HttpInstrumentation(),
  ],
})

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL)


sdk.start()

process.once("SIGINT", () => sdk.shutdown())
process.once("SIGTERM", () => sdk.shutdown())
