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
  return x.version > current.version || snapshotEtag(current) !== snapshotEtag(x)
}
