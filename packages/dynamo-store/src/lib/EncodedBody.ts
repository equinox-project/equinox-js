import { InternalBody } from "./InternalBody"
import { TimelineEvent } from "@equinox-js/core"

export type EncodedBody = [number | undefined, Uint8Array | undefined]

const decodeBody = (raw: InternalBody): EncodedBody => [raw.encoding, raw.data == null ? new Uint8Array() : raw.data]
export const ofInternal = (x: TimelineEvent<InternalBody>): TimelineEvent<EncodedBody> => ({
  ...x,
  data: decodeBody(x.data),
  meta: decodeBody(x.meta),
})

export const toInternal = ([encoding, encodedBody]: EncodedBody): InternalBody => ({
  encoding: encoding ?? 0,
  data: !encodedBody || encodedBody.length === 0 ? undefined : encodedBody,
})
