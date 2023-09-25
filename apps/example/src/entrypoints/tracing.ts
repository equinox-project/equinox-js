import Sdk from "@opentelemetry/sdk-node"
// @ts-ignore
import { PrettyConsoleProcessor } from "opentelemetry-exporter-console-pretty"
import { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base"
import pg from "@opentelemetry/instrumentation-pg"
import http from "@opentelemetry/instrumentation-http"
import express from "@opentelemetry/instrumentation-express"

class FilteringSpanProcessor implements SpanProcessor {
  constructor(
    private predicate: (span: ReadableSpan) => boolean,
    private inner: SpanProcessor,
  ) {}
  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }
  onStart(span: Span, parentContext: Sdk.api.Context): void {
    this.inner.onStart(span, parentContext)
  }
  onEnd(span: ReadableSpan): void {
    if (this.predicate(span)) this.inner.onEnd(span)
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}

const sdk = new Sdk.NodeSDK({
  // @ts-ignore
  spanProcessor: new FilteringSpanProcessor(
    (span) => span.name === "propeller.metric",
    new PrettyConsoleProcessor(),
  ),
  instrumentations: [
    new pg.PgInstrumentation({
      enhancedDatabaseReporting: true,
      requireParentSpan: true,
      responseHook: (span, response) => {
        span.setAttribute("db.row_count", response.data.rowCount)
      },
    }),
    new http.HttpInstrumentation(),
    new express.ExpressInstrumentation(),
  ],
})

sdk.start()
