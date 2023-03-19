import { DynamoStoreContext } from "./DynamoStoreClient.js"
import { Direction } from "./Query.js"
import { StoreClient } from "./StoreClient.js"
import * as Position from "./Position.js"
import * as Token from "./Token.js"
import { StreamToken, ITimelineEvent } from "@equinox-js/core"
import { EncodedBody } from "./EncodedBody.js"

export class EventsContext {
  private readonly storeClient: StoreClient
  constructor(private readonly context: DynamoStoreContext) {
    this.storeClient = context.resolveContainerClientAndStreamId("", "")[0]
  }

  streamId(streamName: string) {
    return this.context.resolveContainerClientAndStreamId("", streamName)[1]
  }

  async _getInternal(
    stream: string,
    minIndex: bigint | undefined,
    maxIndex: bigint | undefined,
    maxCount: number | undefined,
    direction = Direction.Forward
  ): Promise<[StreamToken, ITimelineEvent<EncodedBody>[]]> {
    if (maxCount === 0) {
      const startPosIndex = direction === Direction.Forward ? minIndex : maxIndex
      const startPos = startPosIndex != null ? Position.null_(startPosIndex) : undefined
      return [Token.create(startPos), []]
    }
    const isOrigin = maxCount == null ? () => false : maxCountPredicate(maxCount)
    const [token, events] = await this.storeClient.read(stream, false, direction, (x) => x, isOrigin, minIndex, maxIndex)
    if (direction === Direction.Backward) events.reverse()
    return [token, events]
  }

  async read(
    stream: string,
    minIndex: bigint | undefined,
    maxIndex: bigint | undefined,
    maxCount: number | undefined,
    direction: Direction | undefined
  ): Promise<[Position.Position, ITimelineEvent<EncodedBody>[]]> {
    const [token, events] = await this._getInternal(stream, minIndex, maxIndex, maxCount, direction)
    const p = Token.unpack(token)
    return [Position.flatten(p), events]
  }
}

function maxCountPredicate(count: number) {
  let acc = Math.max(0, count - 1)
  return () => {
    if (acc === 0) return true
    acc -= 1
    return false
  }
}
