import { StreamToken } from "@equinox-js/core"

export const create = (version: bigint): StreamToken => ({
  value: version,
  version: version + 1n,
})
export const streamVersion = (token: StreamToken) => token.value as bigint
export const shouldSnapshot = (
  batchSize: number,
  prev: StreamToken,
  next: StreamToken
) => {
  const previousVersion = prev.version
  const nextVersion = next.version
  const estimatedSnapshotPos =
    previousVersion - (previousVersion % BigInt(batchSize))
  return nextVersion - estimatedSnapshotPos >= BigInt(batchSize)
}
export const supersedes = (current: StreamToken, x: StreamToken) =>
  x.version > current.version
