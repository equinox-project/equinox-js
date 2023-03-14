import { StoreClient } from "./StoreClient.js"
import * as Token from "./Token.js"
import { Codec, StreamEvent, StreamToken, SyncResult, TokenAndState } from "@equinox-js/core"
import { ISR, LFTR, Fold, IsOrigin, MapUnfolds } from "./Internal.js"
import { Position, toEtag, toIndex } from "./Position.js"
import { ExpectedVersion } from "./Sync.js"
import { EncodedBody } from "./EncodedBody.js"
import { LoadedTip } from "./Tip.js"

export class InternalCategory<E, S, C> {
  constructor(private readonly store: StoreClient, private readonly codec: Codec<E, EncodedBody, C>) {}

  async load(
    stream: string,
    requireLeader: boolean,
    initial: S,
    checkUnfolds: boolean,
    fold: Fold<E, S>,
    isOrigin: (e: E) => boolean
  ): Promise<TokenAndState<S>> {
    const [token, events] = await this.store.load(stream, undefined, requireLeader, this.codec.tryDecode, isOrigin, checkUnfolds)
    return { token, state: fold(initial, events) }
  }

  async reload(
    stream: string,
    requireLeader: boolean,
    token: StreamToken,
    state: S,
    fold: Fold<E, S>,
    isOrigin: IsOrigin<E>,
    preloaded?: LoadedTip
  ): Promise<TokenAndState<S>> {
    const result = await this.store.reload(stream, Token.unpack(token), requireLeader, this.codec.tryDecode, isOrigin, preloaded)
    switch (result.type) {
      case LFTR.Unchanged:
        return { token, state }
      case LFTR.Found:
        return { token: result.token, state: fold(state, result.events) }
    }
  }

  async sync(
    stream: string,
    token: StreamToken,
    state: S,
    events: E[],
    mapUnfolds: MapUnfolds<E, S>,
    fold: Fold<E, S>,
    isOrigin: IsOrigin<E>,
    context: C
  ): Promise<SyncResult<S>> {
    const nextState = fold(state, events)
    const pos = Token.unpack(token)
    const encode = async (es: E[]) => {
      const result: StreamEvent<EncodedBody>[] = []
      for (const e of es) result.push(await this.codec.encode(e, context))
      return result
    }
    let exp: (pos?: Position) => ExpectedVersion
    let eventsEncoded: StreamEvent<EncodedBody>[]
    let unfoldsEncoded: StreamEvent<EncodedBody>[] = []
    switch (mapUnfolds.type) {
      case "None":
        exp = toIndex
        eventsEncoded = await encode(events)
        break
      case "Unfold":
        exp = toIndex
        eventsEncoded = await encode(events)
        unfoldsEncoded = await encode(mapUnfolds.unfold(events, nextState))
        break
      case "Transmute": {
        const [events_, unfolds] = mapUnfolds.transmute(events, nextState)
        exp = (x) => toEtag(x)!
        events = events_
        eventsEncoded = await encode(events_)
        unfoldsEncoded = await encode(unfolds)
      }
    }
    const baseVer = toIndex(pos) + BigInt(events.length)
    const res = await this.store.sync(stream, pos, exp, baseVer, eventsEncoded, unfoldsEncoded)
    switch (res.type) {
      case ISR.ConflictUnknown:
        return { type: "Conflict", resync: () => this.reload(stream, true, token, state, fold, isOrigin) }
      case ISR.Written:
        return { type: "Written", data: { token: res.token, state: nextState } }
    }
  }
}
