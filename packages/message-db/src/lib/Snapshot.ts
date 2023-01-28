import { StreamToken, TimelineEvent } from "@equinox-js/core"
import * as Token from "./Token"
import { Format } from "./MessageDbClient"

export const snapshotCategory = (original: string) => original + ":snapshot"

export const streamName = (category: string, streamId: string) => `${category}-${streamId}`
export type Meta = { streamVersion: string }
const streamVersion = (evt: TimelineEvent<Format>) => {
  const meta = evt.meta as Meta | null
  return meta ? BigInt(meta.streamVersion) : -1n
}

export const meta = (token: StreamToken): Meta => ({
  streamVersion: String(Token.streamVersion(token)),
})
export const decode = <V>(
  tryDecode: (ev: TimelineEvent<Format>) => V | null | undefined,
  events: TimelineEvent<Format>[]
): [StreamToken, V] | null => {
  if (events.length > 0) {
    const decoded = tryDecode(events[0])
    if (decoded != null) return [Token.create(streamVersion(events[0])), decoded]
  }
  return null
}
