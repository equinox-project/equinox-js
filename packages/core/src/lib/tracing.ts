import { trace } from "@opentelemetry/api"

export const tracer = trace.getTracer("@equinox/core", "1.0.0")
