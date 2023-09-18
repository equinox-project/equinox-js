import { ITimelineEvent, StreamName } from "@equinox-js/core"

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
  pump(batch: IngesterBatch, signal: AbortSignal): Promise<void>
}
