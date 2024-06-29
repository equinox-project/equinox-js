module Crypto = {
  @module("crypto") @val
  external randomUUID: unit => string = "randomUUID"
}

module TimelineEvent = {
  type t<'format> = {
    id: string,
    time: Js.Date.t,
    @as("type")
    type_: string,
    data?: 'format,
    meta?: 'format,
    index: bigint,
    isUnfold: bool,
    size: int,
  }
}

module EventData = {
  type t<'format> = {
    id?: string,
    @as("type")
    type_: string,
    data?: 'format,
    meta?: 'format,
  }

  let toTimelineEvent = (index, ev: t<'a>): TimelineEvent.t<'a> => {
    let id = switch ev.id {
    | None => Crypto.randomUUID()
    | Some(x) => x
    }
    let time = Js.Date.make()
    let isUnfold = false
    let size = 0
    {id, time, type_: ev.type_, data: ?ev.data, meta: ?ev.meta, index, isUnfold, size}
  }
}
