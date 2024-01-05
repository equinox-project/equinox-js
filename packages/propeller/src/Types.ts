import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Attributes } from "@opentelemetry/api"

export type Batch = {
  items: [StreamName, ITimelineEvent][]
  checkpoint: bigint
  isTail: boolean
}

export type IngesterBatch = {
  items: [StreamName, ITimelineEvent][]
  checkpoint: bigint
  onComplete(): void
  isTail: boolean
}

export interface Sink {
  pump(batch: IngesterBatch, signal: AbortSignal): Promise<void> | void
  addTracingAttrs(attrs: Attributes): void
  start(signal: AbortSignal): Promise<void>
}
