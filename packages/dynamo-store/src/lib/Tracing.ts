import { trace } from "@opentelemetry/api"

export const tracer = trace.getTracer("@equinox-js/dynamo-store")
