import { StreamToken, TimelineEvent } from "@equinox-js/core"
import * as Token from "./Token.js"
import { Format } from "./MessageDbClient.js"

export const snapshotCategory = (original: string) => original + ":snapshot"

export const streamName = (category: string, streamId: string) => `${category}-${streamId}`
export type Meta = { streamVersion: string }
const streamVersion = (evt: TimelineEvent<Format>) => {
  const meta = JSON.parse(evt.meta ?? "null") as Meta | null
  return meta ? BigInt(meta.streamVersion) : -1n
}

export const meta = (token: StreamToken): Meta => ({
  streamVersion: String(Token.streamVersion(token)),
})
export async function decode<V>(
  tryDecode: (ev: TimelineEvent<Format>) => Promise<V | null | undefined> | V | null | undefined,
  events: TimelineEvent<Format>[]
): Promise<[StreamToken, V] | null> {
  if (events.length > 0) {
    const decoded = await tryDecode(events[0])
    if (decoded != null) return [Token.create(streamVersion(events[0])), decoded]
  }
  return null
}
