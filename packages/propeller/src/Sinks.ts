import { ITimelineEvent } from "@equinox-js/core"

export type StreamResult =
  | { type: "NoneProcessed" }
  | { type: "AllProcessed" }
  | { type: "PartiallyProcessed"; count: number }
  | { type: "OverrideNextIndex"; index: bigint }

export namespace StreamResult {
  /**
   * Indicates no events where processed.
   * Handler should be supplied the same events (plus any that arrived in the interim) in the next scheduling cycle.
   */
  export const NoneProcessed: StreamResult = { type: "NoneProcessed" }

  /**
   * Indicates all <c>Event</c>s supplied have been processed.
   * Write Position should move beyond the last event supplied.
   */
  export const AllProcessed: StreamResult = { type: "AllProcessed" }

  /**
   * Indicates only a subset of the presented events have been processed;
   * Write Position should remove <c>count</c> items from the <c>Event</c>s supplied.
   */
  export const PartiallyProcessed = (count: number): StreamResult => ({
    type: "PartiallyProcessed",
    count,
  })

  /**
   * Apply an externally observed Version determined by the handler during processing.
   * If the Version of the stream is running ahead or behind the current input StreamSpan, this enables one to have
   * events that have already been handled be dropped from the scheduler's buffers and/or as they arrive.
   */
  export const OverrideNextIndex = (index: bigint): StreamResult => ({
    type: "OverrideNextIndex",
    index,
  })

  export const toIndex = (span: ITimelineEvent[], result: StreamResult): bigint => {
    switch (result?.type) {
      case "NoneProcessed":
        return span[0]!.index
      case "AllProcessed":
        return span[0]!.index + BigInt(span.length)
      case "PartiallyProcessed":
        return span[0]!.index + BigInt(result.count)
      case "OverrideNextIndex":
        return result.index
    }
  }
}
