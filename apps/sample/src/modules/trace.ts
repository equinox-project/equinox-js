import * as opentelemetry from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"

// For troubleshooting, set the log level to DiagLogLevel.DEBUG
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)

const sdk = new opentelemetry.NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  resource: new opentelemetry.resources.Resource({
    "service.name": "TodoSample",
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-aws-sdk": {
        // So we don't record the underlying HTTP requests
        suppressInternalInstrumentation: true,
      },
    }),
  ],
})

sdk.start()
