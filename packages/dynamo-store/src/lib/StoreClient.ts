import { InternalSyncResult, ISR, LFTR, LoadFromTokenResult } from "./Internal"
import { Container } from "./Container"
import * as Tip from "./Tip"
import * as Token from "./Token"
import { fromElements, Position, toIndex } from "./Position"
import { StreamEvent, StreamToken, TimelineEvent } from "@equinox-js/core"
import * as Query from "./Query"
import { Direction } from "./Query"
import { tipMagicI } from "./Batch"
import * as Sync from "./Sync"
import { EncodedBody } from "./EncodedBody"
import { InternalBody } from "./InternalBody"

export type QueryOptions = {
  /** Limit for Maximum number of `Batch` records in a single query batch response */
  maxItems: number
  /** Maximum number of trips to permit when slicing the work into multiple responses based on `MaxItems` */
  maxRequests?: number
  /** Whether to inhibit throwing when events are missing, but no Archive Table has been supplied as a fallback */
  ignoreMissingEvents: boolean
}

export type TipOptions = {
  /** Maximum number of events permitted in Tip. When this is exceeded, events are moved out to a standalone Batch. Default: limited by MaxBytes */
  maxEvents?: number
  /** Maximum serialized size to permit to accumulate in Tip before events get moved out to a standalone Batch. Default: 32K. */
  maxBytes: number
}

export type TipRet = [Position, bigint, TimelineEvent<InternalBody>[]]
type TryDecode<E> = (e: TimelineEvent<EncodedBody>) => Promise<E | undefined> | E | undefined

export class StoreClient {
  constructor(
    private readonly container: Container,
    private readonly fallback: Container | undefined,
    private readonly query: QueryOptions,
    private readonly tip: TipOptions
  ) {}

  private loadTip(stream: string, consistentRead: boolean, pos?: Position) {
    return Tip.tryLoad(this.container, stream, consistentRead, pos, undefined)
  }

  async read<E>(
    stream: string,
    consistentRead: boolean,
    direction: Query.Direction,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    minIndex?: bigint,
    maxIndex?: bigint,
    tipRet?: TipRet
  ): Promise<[StreamToken, E[]]> {
    const tip = tipRet && (await Query.scanTip(tryDecode, isOrigin, tipRet))
    maxIndex = maxIndex ?? (tip ? tipMagicI : undefined)
    const walk = (container: Container) => (minIndex: bigint | undefined, maxIndex: bigint | undefined) =>
      Query.scan(container, stream, consistentRead, this.query.maxItems, this.query.maxRequests, direction, tryDecode, isOrigin, minIndex, maxIndex)
    const walkFallback = this.fallback == null ? this.query.ignoreMissingEvents : walk(this.fallback)
    const [pos, events] = await Query.load(minIndex, maxIndex, tip, walk(this.container), walkFallback)
    return [Token.create(pos), events]
  }

  readLazy<E>(
    batching: QueryOptions,
    stream: string,
    direction: Query.Direction,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    minIndex?: bigint,
    maxIndex?: bigint
  ): AsyncIterable<E[]> {
    return Query.walkLazy(this.container, stream, batching.maxItems, batching.maxRequests, tryDecode, isOrigin, direction, minIndex, maxIndex)
  }

  async load<E>(
    stream: string,
    maybePos: Position | undefined,
    consistentRead: boolean,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    checkUnfolds: boolean
  ): Promise<[StreamToken, E[]]> {
    if (!checkUnfolds) return this.read(stream, consistentRead, Direction.Backward, tryDecode, isOrigin)
    const res = await this.loadTip(stream, consistentRead, maybePos)
    switch (res.type) {
      case Tip.ResType.NotFound:
        return [Token.empty, []]
      case Tip.ResType.NotModified:
        throw new Error("Not applicable")
      case Tip.ResType.Found:
        return this.read(stream, consistentRead, Direction.Backward, tryDecode, isOrigin, undefined, undefined, res.value)
    }
  }

  async getPosition(stream: string, pos?: Position) {
    const res = await this.loadTip(stream, false, pos)
    switch (res.type) {
      case Tip.ResType.NotFound:
        return Token.empty
      case Tip.ResType.NotModified:
        return Token.create(pos)
      case Tip.ResType.Found:
        return Token.create(res.value[0])
    }
  }

  async reload<E>(
    stream: string,
    maybePos: Position | undefined,
    consistentRead: boolean,
    tryDecode: TryDecode<E>,
    isOrigin: (e: E) => boolean,
    preview?: TipRet
  ): Promise<LoadFromTokenResult<E>> {
    const read = async (tipContent: TipRet): Promise<LoadFromTokenResult<E>> => {
      const res = await this.read(stream, consistentRead, Direction.Backward, tryDecode, isOrigin, toIndex(maybePos), undefined, tipContent)
      return { type: LFTR.Found, token: res[0], events: res[1] }
    }
    if (preview != null) return read(preview)
    const res = await this.loadTip(stream, consistentRead, maybePos)
    switch (res.type) {
      case Tip.ResType.NotFound:
        return { type: LFTR.Found, token: Token.empty, events: [] }
      case Tip.ResType.NotModified:
        return { type: LFTR.Unchanged }
      case Tip.ResType.Found:
        return read(res.value)
    }
  }

  async sync(
    stream: string,
    pos: Position | undefined,
    exp: (p?: Position) => Sync.ExpectedVersion,
    n_: bigint,
    eventsEncoded: StreamEvent<EncodedBody>[],
    unfoldsEncoded: StreamEvent<EncodedBody>[]
  ): Promise<InternalSyncResult> {
    const res = await Sync.handle(this.tip.maxEvents, this.tip.maxBytes, this.container, stream, pos, exp, n_, eventsEncoded, unfoldsEncoded)
    switch (res.type) {
      case "ConflictUnknown":
        return { type: ISR.ConflictUnknown }
      case "Written":
        return { type: ISR.Written, token: Token.create(fromElements(stream, res.predecessorBytes, n_, res.events, res.unfolds, res.etag)) }
    }
  }
}
