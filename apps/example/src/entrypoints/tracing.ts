import hc from '@honeycombio/opentelemetry-node'
import pg from '@opentelemetry/instrumentation-pg'
import http from '@opentelemetry/instrumentation-http'
import express from '@opentelemetry/instrumentation-express'

const sdk = new hc.HoneycombSDK({
  instrumentations: [
    new pg.PgInstrumentation({
      enhancedDatabaseReporting: true,
      requireParentSpan: true,
      responseHook: (span, response) => {
        span.setAttribute('db.row_count', response.data.rowCount)
      }
    }),
    new http.HttpInstrumentation(),
    new express.ExpressInstrumentation()
  ]
})

sdk.start()
