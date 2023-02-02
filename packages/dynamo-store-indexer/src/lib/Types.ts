export namespace AppendsEpochId {
  export type t = number & { __brand: "AppendsEpochId" }
  export const initial = 0 as t
  export const toString = (id: t) => String(id)
  export const next = (value: t) => (value + 1) as t
  export const parse = (n: string) => Number(n) as t
}

export namespace AppendsTrancheId {
  export type t = number & { __brand: "AppendsTrancheId" }
  export const wellKnownId = 0 as t
  export const toString = (id: t) => String(id)
  export const parse = (n: string) => Number(n) as t
}

export namespace Checkpoint {
  export type t = bigint & { __brand: "Checkpoint" }
  /** The absolute upper limit of number of streams that can be indexed within a single Epoch (defines how Checkpoints are encoded, so cannot be changed) */
  export const MAX_ITEMS_PER_EPOCH = 1_000_000
  const maxItemsPerEpoch = 1_000_000n

  export const positionOfEpochAndOffset = (epoch: AppendsEpochId.t, offset: bigint) => BigInt(epoch) * maxItemsPerEpoch + offset
  export const positionOfEpochClosedAndVersion = (epoch: AppendsEpochId.t, isClosed: boolean, version: bigint) => {
    const offset = isClosed ? 0n : version
    return positionOfEpochAndOffset(epoch, offset)
  }
  export const toEpochAndOffset = (value: t): [AppendsEpochId.t, bigint] => {
    const d = value / maxItemsPerEpoch
    const r = value % maxItemsPerEpoch
    return [Number(d) as AppendsEpochId.t, r]
  }
}

export namespace IndexStreamId {
  export type t = string & { __brand: "IndexStreamId " }
  export const toString = (x: t) => x as string
  export const ofString = (x: string) => x as t
}

/*

module Checkpoint =

    /// The absolute upper limit of number of streams that can be indexed within a single Epoch (defines how Checkpoints are encoded, so cannot be changed)
    let [<Literal>] MaxItemsPerEpoch = 1_000_000
    let private maxItemsPerEpoch = int64 MaxItemsPerEpoch
    let private ofPosition : Propulsion.Feed.Position -> Checkpoint = Propulsion.Feed.Position.toInt64 >> UMX.tag

    let internal positionOfEpochAndOffset (epoch : AppendsEpochId) offset : Propulsion.Feed.Position =
        int64 (AppendsEpochId.value epoch) * maxItemsPerEpoch + int64 offset |> UMX.tag

    let positionOfEpochClosedAndVersion (epoch : AppendsEpochId) isClosed version : Propulsion.Feed.Position =
        let epoch, offset =
            if isClosed then AppendsEpochId.next epoch, 0L
            else epoch, version
        positionOfEpochAndOffset epoch offset

    let private toEpochAndOffset (value : Checkpoint) : struct (AppendsEpochId * int) =
        let d, r = System.Math.DivRem(%value, maxItemsPerEpoch)
        (%int %d : AppendsEpochId), int r

    let internal (|Parse|) : Propulsion.Feed.Position -> struct (AppendsEpochId * int) = ofPosition >> toEpochAndOffset
 */
