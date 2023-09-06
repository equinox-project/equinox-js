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

export type IndexStreamId = string & { __brand: "IndexStreamId" }
export namespace IndexStreamId {
  export const toString = (x: IndexStreamId) => x as string
  export const ofString = (x: string) => x as IndexStreamId
}
