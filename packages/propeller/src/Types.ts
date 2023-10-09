import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { Attributes } from "@opentelemetry/api"

export type EventHandler<Format> = (
  sn: StreamName,
  events: ITimelineEvent<Format>[],
) => Promise<void>

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
  start?: (signal: AbortSignal) => Promise<void>
  pump(batch: IngesterBatch, signal: AbortSignal): Promise<void> | void
  addTracingAttrs(attrs: Attributes): void
}
