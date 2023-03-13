import { Span, SpanOptions, trace } from "@opentelemetry/api"

export const tracer = trace.getTracer("@equinox-js/dynamo-store")

export const withSpan = <T>(name: string, opts: SpanOptions, fn: (span: Span) => Promise<T>): Promise<T> =>
  tracer.startActiveSpan(name, opts, (span) => fn(span).finally(() => span.end()))
