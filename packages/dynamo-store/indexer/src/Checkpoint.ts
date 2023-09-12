import { AppendsEpochId } from "./Identifiers.js"

export type Checkpoint = bigint & { __brand: "Checkpoint" }
export namespace Checkpoint {
  /** The absolute upper limit of number of streams that can be indexed within a single Epoch (defines how Checkpoints are encoded, so cannot be changed) */
  export const MAX_ITEMS_PER_EPOCH = 1_000_000
  const maxItemsPerEpoch = 1_000_000n

  export const ofPosition = (b: bigint) => b as Checkpoint

  export const positionOfEpochAndOffset = (epoch: AppendsEpochId, offset: bigint) =>
    (BigInt(epoch) * maxItemsPerEpoch + offset) as Checkpoint
  export const positionOfEpochClosedAndVersion = (
    epoch: AppendsEpochId,
    isClosed: boolean,
    version: bigint,
  ) => {
    if (isClosed) return positionOfEpochAndOffset(AppendsEpochId.next(epoch), 0n)
    return positionOfEpochAndOffset(epoch, version)
  }
  export const initial = ofPosition(0n)
  export const toEpochAndOffset = (value: Checkpoint): [AppendsEpochId, bigint] => {
    const d = value / maxItemsPerEpoch
    const r = value % maxItemsPerEpoch
    return [Number(d) as AppendsEpochId, r]
  }
}
