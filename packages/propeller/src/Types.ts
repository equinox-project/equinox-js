import { ITimelineEvent, StreamName } from "@equinox-js/core"

export type Batch = {
  items: [StreamName, ITimelineEvent][]
  checkpoint: bigint
  isTail: boolean
}

export interface Sink {
  pump(batch: Batch): Promise<void>
}
