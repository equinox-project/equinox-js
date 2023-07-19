import { StreamToken, ITimelineEvent } from "@equinox-js/core"
import * as Token from "./Token.js"
import { Format } from "./MessageDbClient.js"

export const snapshotCategory = (original: string) => original + ":snapshot"

export const streamName = (category: string, streamId: string) =>
  `${snapshotCategory(category)}-${streamId}`
export type Meta = { streamVersion: string }
const streamVersion = (evt: ITimelineEvent<Format>) => {
  const meta = JSON.parse(evt.meta ?? "null") as Meta | null
  return meta ? BigInt(meta.streamVersion) : -1n
}

export const meta = (token: StreamToken): Meta => ({
  streamVersion: String(Token.streamVersion(token)),
})
export async function decode<V>(
  tryDecode: (ev: ITimelineEvent<Format>) => Promise<V | null | undefined> | V | null | undefined,
  events: ITimelineEvent<Format>[],
): Promise<[StreamToken, V] | null> {
  if (events.length > 0) {
    const decoded = await tryDecode(events[0])
    if (decoded != null) return [Token.create(streamVersion(events[0])), decoded]
  }
  return null
}
