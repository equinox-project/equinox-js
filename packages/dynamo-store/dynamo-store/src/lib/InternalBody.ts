export type InternalBody = { encoding: number; data?: Uint8Array }
export const ofBufferAndEncoding = (data?: Uint8Array, encoding?: number) => ({
  encoding: encoding || 0,
  data: data,
})
export const toBufferAndEncoding = (x: InternalBody) => [x.data, x.encoding || undefined] as const
export const bytes = (x: InternalBody) => x.data?.length ?? 0
