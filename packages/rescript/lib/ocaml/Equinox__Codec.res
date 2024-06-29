open Equinox__Types

type t<'e, 'f, 'c> = {
  tryDecode: TimelineEvent.t<'f> => option<'e>,
  encode: ('e, 'c) => EventData.t<'f>,
}

let json = (encode, tryDecode) => {
  let tryDecode = (ev: TimelineEvent.t<'f>) => tryDecode((ev.type_, ev.data))
  let encode = (ev, ctx): EventData.t<string> => {
    let (type_, data) = encode(ev, ctx)
    {type_, ?data}
  }
  {tryDecode, encode}
}
