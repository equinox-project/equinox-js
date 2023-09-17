import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { traceHandler, EventHandler } from "./Tracing.js"
import pLimit, { LimitFunction } from "p-limit"
import { Attributes, trace } from "@opentelemetry/api"
import { Batch, Sink } from "./Types.js"

function groupByStream(items: [StreamName, ITimelineEvent][]): Map<StreamName, ITimelineEvent[]> {
  const streams = new Map<StreamName, ITimelineEvent[]>()
  for (const [streamName, event] of items) {
    const events = streams.get(streamName) || []
    events.push(event)
    streams.set(streamName, events)
  }
  return streams
}

const tracer = trace.getTracer("@equinox-js/propeller")

export class StreamsSink implements Sink {
  private readonly limit: LimitFunction
  constructor(
    private readonly handle: EventHandler<string>,
    maxConcurrentStreams: number,
    private readonly tracingAttrs: Attributes = {},
  ) {
    this.limit = pLimit(maxConcurrentStreams)
    this.addTracingAttrs({ "eqx.max_concurrent_streams": maxConcurrentStreams })
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  async pump(batch: Batch) {
    const streams = groupByStream(batch.items)
    const promises: Promise<void>[] = []
    for (const [streamName, events] of streams) {
      promises.push(
        this.limit(() =>
          traceHandler(
            tracer,
            this.tracingAttrs,
            StreamName.category(streamName),
            streamName,
            events,
            this.handle,
          ),
        ),
      )
    }
    await Promise.all(promises)
  }
}
