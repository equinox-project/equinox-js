import { InternalBody } from "./InternalBody.js"
import { TimelineEvent } from "@equinox-js/core"

export type EncodedBody = [number | undefined, Uint8Array | undefined]

const decodeBody = (raw: InternalBody | undefined): EncodedBody => [raw?.encoding, raw?.data]
export const ofInternal = (x: TimelineEvent<InternalBody>): TimelineEvent<EncodedBody> => ({
  ...x,
  data: decodeBody(x.data),
  meta: decodeBody(x.meta),
})

export const toInternal = ([encoding, encodedBody]: EncodedBody = [0, undefined]): InternalBody => ({
  encoding: encoding ?? 0,
  data: !encodedBody || encodedBody.length === 0 ? undefined : encodedBody,
})
