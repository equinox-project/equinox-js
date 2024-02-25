import { StreamToken, ITimelineEvent } from "@equinox-js/core"
import * as Token from "./Token.js"
import { Format } from "./MessageDbClient.js"

export const snapshotCategory = (original: string) => original + ":snapshot"

export const streamName = (category: string, streamId: string) =>
  `${snapshotCategory(category)}-${streamId}`
export type Meta = { streamVersion: string } | { version: string }
const snapshotVersion = (evt: ITimelineEvent<Format>) => {
  const meta = JSON.parse(evt.meta ?? "null") as Meta | null
  if (!meta) return 0n
  if ("version" in meta) return BigInt(meta.version)
  return BigInt(meta.streamVersion) + 1n
}

export const meta = (token: StreamToken): Meta => ({
  version: String(Token.version(token)),
})
export function decode<V>(
  decode: (ev: ITimelineEvent<Format>) => V | null | undefined,
  events: ITimelineEvent<Format>[],
): [StreamToken, V] | null {
  if (events.length > 0) {
    const decoded = decode(events[0])
    if (decoded != null) return [Token.create(snapshotVersion(events[0])), decoded]
  }
  return null
}
