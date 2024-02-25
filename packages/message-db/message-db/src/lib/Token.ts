import { StreamToken } from "@equinox-js/core"

type TokenValue = { max_index: bigint; snapshot_version?: bigint }

export const create = (version: bigint, snapshot_version?: bigint): StreamToken => ({
  value: { max_index: version - 1n, snapshot_version } satisfies TokenValue,
  version: version,
  bytes: -1n,
})
const tokenValue = (token: StreamToken) => token.value as TokenValue
export const version = (token: StreamToken) => token.version
export const maxIndex = (token: StreamToken) => tokenValue(token).max_index
export const snapshotVersion = (token: StreamToken) => tokenValue(token).snapshot_version ?? 0n

export const withSnapshot = (token: StreamToken, snapshot: bigint) => {
  const value = tokenValue(token)
  return {
    value: { version: value.max_index, snapshot_version: snapshot },
    version: token.version,
    bytes: -1n,
  }
}

export const shouldSnapshot = (frequency: number, previous: StreamToken, next: StreamToken) => {
  const lastSnapshot = snapshotVersion(previous)
  const diff = next.version - lastSnapshot
  return diff >= BigInt(frequency)
}
export const supersedes = (current: StreamToken, x: StreamToken) => x.version > current.version
