export type AppendsEpochId = number & { __brand: "AppendsEpochId" }
export namespace AppendsEpochId {
  export const initial = 0 as AppendsEpochId
  export const toString = (id: AppendsEpochId) => String(id)
  export const next = (value: AppendsEpochId) => (value + 1) as AppendsEpochId
  export const parse = (n: string) => Number(n) as AppendsEpochId
}

export type AppendsPartitionId = number & { __brand: "AppendsPartitionId" }
export namespace AppendsPartitionId {
  // Partitioning is not yet implemented
  export const wellKnownId = 0 as AppendsPartitionId
  export const toString = (x: AppendsPartitionId) => x.toString()
  export const toTrancheId = (x: AppendsPartitionId) => toString(x)
  export const parse = (s: string): AppendsPartitionId => {
    const n = Number(s)
    if (Number.isNaN(n)) throw new Error(`Invalid AppendsPartitionId: ${s}`)
    return n as AppendsPartitionId
  }
}

export type IndexStreamId = string & { __brand: "IndexStreamId" }
export namespace IndexStreamId {
  export const toString = (x: IndexStreamId) => x as string
  export const ofString = (x: string) => x as IndexStreamId
}
