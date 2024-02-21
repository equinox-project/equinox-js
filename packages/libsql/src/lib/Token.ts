import { StreamToken } from "@equinox-js/core"

type TokenValue = { snapshot_etag?: string }

export const create = (version: bigint, snapshot?: string): StreamToken => ({
  value: { snapshot_etag: snapshot } satisfies TokenValue,
  version: version,
  bytes: -1n,
})

const tokenValue = (token: StreamToken) => token.value as TokenValue
export const version = (token: StreamToken) => token.version
export const snapshotEtag = (token: StreamToken) => tokenValue(token).snapshot_etag

export const supersedes = (current: StreamToken, x: StreamToken) => {
  const etag1 = snapshotEtag(current)
  const etag2 = snapshotEtag(x)
  if (etag2 != null && etag1 !== etag2) return true
  return x.version > current.version
}
