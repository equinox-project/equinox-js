import { StreamToken } from "@equinox-js/core"

type TokenValue = { version: bigint; snapshot_version?: bigint }

export const create = (version: bigint, snapshot?: bigint): StreamToken => ({
  value: { version, snapshot_version: snapshot },
  version: version + 1n,
  bytes: -1n,
})
const tokenValue = (token: StreamToken) => token.value as TokenValue
export const streamVersion = (token: StreamToken) => tokenValue(token).version
export const snapshotVersion = (token: StreamToken) => tokenValue(token).snapshot_version ?? 0n

export const withSnapshot = (token: StreamToken, snapshot: bigint) => {
  const value = tokenValue(token)
  return {
    value: { version: value.version, snapshot_version: snapshot },
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
