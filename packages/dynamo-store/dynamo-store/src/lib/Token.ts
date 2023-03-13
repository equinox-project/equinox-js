import { StreamToken } from "@equinox-js/core"
import { Position, toVersionAndStreamBytes } from "./Position"

export const create = (pos: Position | undefined): StreamToken => {
  const [v, b] = toVersionAndStreamBytes(pos)
  return { value: { pos }, version: v, bytes: BigInt(b) }
}
export const empty = create(undefined)
export const unpack = (token: StreamToken): Position | undefined => (token?.value as any)?.pos
export const supersedes = (at: StreamToken, bt: StreamToken) => {
  const a = unpack(at)
  const b = unpack(bt)
  if (a && b) return a.index > b.index || a.etag !== b.etag
  return Boolean(!a && b)
}
