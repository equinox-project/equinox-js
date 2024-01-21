import { ITimelineEvent } from "@equinox-js/core"

export type StreamResult =
  | { type: "NoneProcessed" }
  | { type: "AllProcessed" }
  | { type: "PartiallyProcessed"; count: number }
  | { type: "OverrideNextIndex"; version: bigint }

export namespace StreamResult {
  export const NoneProcessed: StreamResult = { type: "NoneProcessed" }
  export const AllProcessed: StreamResult = { type: "AllProcessed" }
  export const PartiallyProcessed = (count: number): StreamResult => ({
    type: "PartiallyProcessed",
    count,
  })
  export const OverrideNextIndex = (version: bigint): StreamResult => ({
    type: "OverrideNextIndex",
    version,
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
        return result.version
    }
  }
}
