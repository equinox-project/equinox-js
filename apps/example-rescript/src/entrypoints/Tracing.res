type instrumentation
type spanProcessor

module Span = {
type t
  @send
  external setAttribute: (t, string, Js.Json.t) => unit = "setAttribute"
}

module PrettyConsoleProcessor = {
  @module("opentelemetry-exporter-console-pretty") @new
  external make: unit => spanProcessor = "PrettyConsoleProcessor"
}

module PgInstrumentation = {
  type responseData = { rowCount: int, }
  type response = { data: responseData, }
  type options = {
    enhancedDatabaseReporting: bool,
    requireParentSpan: bool,
    responseHook: (Span.t, response) => unit,
  }
  @module("@opentelemetry/instrumentation-pg") @new
  external make: options => instrumentation = "PgInstrumentation"
}

module HttpInstrumentation = {
  @module("@opentelemetry/instrumentation-http") @new
  external make: unit => instrumentation = "HttpInstrumentation"
}

module ExpressInstrumentation = {
  @module("@opentelemetry/instrumentation-express") @new
  external make: unit => instrumentation = "ExpressInstrumentation"
}

module NodeSDK = {
  type t
  type options = {
    spanProcessor: spanProcessor,
    instrumentations: array<instrumentation>,
  }
  @module("@opentelemetry/sdk-node") @new
  external make: options => t = "NodeSDK" 

  @send
  external start: t => unit = "start"
}


let sdk = NodeSDK.make({
  spanProcessor: PrettyConsoleProcessor.make(),
  instrumentations: [
    PgInstrumentation.make({
      PgInstrumentation.enhancedDatabaseReporting: true,
      requireParentSpan: true,
      responseHook: (span, response) => {
        span->Span.setAttribute("db.row_count", response.data.rowCount->Obj.magic)
      },
    }),
    HttpInstrumentation.make(),
    ExpressInstrumentation.make(),
  ],
})

sdk->NodeSDK.start
