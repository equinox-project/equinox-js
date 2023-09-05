export type AppendsEpochId = number & { __brand: "AppendsEpochId" }
export namespace AppendsEpochId {
  export const initial = 0 as AppendsEpochId
  export const toString = (id: AppendsEpochId) => String(id)
  export const next = (value: AppendsEpochId) => (value + 1) as AppendsEpochId
  export const parse = (n: string) => Number(n) as AppendsEpochId
}

export type AppendsTrancheId = number & { __brand: "AppendsTrancheId" }
export namespace AppendsTrancheId {
  export const wellKnownId = 0 as AppendsTrancheId
  export const toString = (id: AppendsTrancheId) => String(id)
  export const parse = (n: string) => Number(n) as AppendsTrancheId
}

export namespace Checkpoint {
  export type t = bigint & { __brand: "Checkpoint" }
  /** The absolute upper limit of number of streams that can be indexed within a single Epoch (defines how Checkpoints are encoded, so cannot be changed) */
  export const MAX_ITEMS_PER_EPOCH = 1_000_000
  const maxItemsPerEpoch = 1_000_000n

  export const positionOfEpochAndOffset = (epoch: AppendsEpochId, offset: bigint) =>
    (BigInt(epoch) * maxItemsPerEpoch + offset) as t
  export const positionOfEpochClosedAndVersion = (
    epoch: AppendsEpochId,
    isClosed: boolean,
    version: bigint,
  ) => {
    const offset = isClosed ? 0n : version
    return positionOfEpochAndOffset(epoch, offset)
  }
  export const initial = 0n as t
  export const toEpochAndOffset = (value: t): [AppendsEpochId, bigint] => {
    const d = value / maxItemsPerEpoch
    const r = value % maxItemsPerEpoch
    return [Number(d) as AppendsEpochId, r]
  }
}

export type IndexStreamId = string & { __brand: "IndexStreamId" }
export namespace IndexStreamId {
  export const toString = (x: IndexStreamId) => x as string
  export const ofString = (x: string) => x as IndexStreamId
}
