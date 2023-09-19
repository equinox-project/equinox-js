import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { traceHandler, EventHandler } from "./Tracing.js"
import { Attributes, trace } from "@opentelemetry/api"
import { IngesterBatch, Sink } from "./Types.js"
import { Queue } from "./Queue.js"

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

const createLinkedAbortController = (signal: AbortSignal) => {
  const ctrl = new AbortController()
  signal.addEventListener("abort", () => ctrl.abort())
  return ctrl
}

class Stream {
  events: ITimelineEvent[] = []
  constructor(public name: StreamName) {}

  merge(event: ITimelineEvent): void {
    const last = this.events[this.events.length - 1]
    if (!last || last.index === event.index - 1n) {
      this.events.push(event)
      return
    }
    if (last.index > event.index) return
    if (event.index > last.index) throw new Error("Unexpected gap")
  }
}

const getOrAdd = <K, V>(map: Map<K, V>, key: K, val: () => V) => {
  const current = map.get(key)
  if (current == null) {
    const value = val()
    map.set(key, value)
    return value
  }
  return current
}

export class StreamsSink implements Sink {
  private queue = new Queue<Stream>()
  private streams = new Map<StreamName, Stream>()
  private batchStreams = new Map<IngesterBatch, Set<StreamName>>()
  private onReady?: () => void 
  private inProgressBatches = 0
  constructor(
    private readonly handle: EventHandler<string>,
    private maxConcurrentStreams: number,
    private maxReadAhead: number,
    private readonly tracingAttrs: Attributes = {},
  ) {
    this.addTracingAttrs({ "eqx.max_concurrent_streams": maxConcurrentStreams })
  }

  addTracingAttrs(attrs: Attributes) {
    Object.assign(this.tracingAttrs, attrs)
  }

  start(signal: AbortSignal) {
    return new Promise<void>((_resolve, reject) => {
      let stopped = false
      const aux = async (): Promise<void> => {
        if (signal.aborted || stopped) return
        const stream = this.queue.tryGet()
        if (!stream) return void setImmediate(aux)
        this.streams.delete(stream.name)
        await traceHandler(
          tracer,
          this.tracingAttrs,
          StreamName.category(stream.name),
          stream.name,
          stream.events,
          this.handle,
        ).catch((err) => {
          reject(err)
          stopped = true
        })
        for (const [batch, streams] of this.batchStreams) {
          streams.delete(stream.name)
          if (streams.size === 0) {
            batch.onComplete()
            this.batchStreams.delete(batch)
            this.inProgressBatches--
            this.onReady?.()
            delete this.onReady
          }
        }
        setImmediate(aux)
      }

      for (let i = 0; i < this.maxConcurrentStreams; ++i) aux()
    })
  }

  pump(batch: IngesterBatch, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      this.inProgressBatches++
      const names = new Set<StreamName>()
      this.batchStreams.set(batch, names)
      for (const [sn, event] of batch.items) {
        names.add(sn)
        const stream = getOrAdd(this.streams, sn, () => {
          const stream = new Stream(sn)
          this.queue.add(stream)
          return stream
        })
        stream.merge(event)
      }

      if (this.inProgressBatches === this.maxReadAhead) {
        const abort = () => reject(new Error("Aborted"))
        signal.addEventListener("abort", abort)
        this.onReady = () => {
          signal.removeEventListener("abort", abort)
          resolve()
        }
      } else {
        resolve()
      }
    })
  }
}
