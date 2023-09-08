import { test, expect } from "vitest"
import * as AppendsIndex from "./AppendsIndex.js"
import { AppendsEpochId, AppendsPartitionId } from "./Identifiers"
import zlib from "zlib"

test("Serialises, writing as expected", () => {
  const enc = AppendsIndex.Events.codec.encode(
    {
      type: "Started",
      data: { partition: AppendsPartitionId.wellKnownId, epoch: AppendsEpochId.parse("2") },
    },
    null,
  )
  const body = zlib.inflateSync(enc.data!).toString()
  expect(body).toEqual(`{"partition":0,"epoch":2}`)
})

test("Deserialises with upconversion", () => {
  const data = zlib.deflateSync(Buffer.from(JSON.stringify({ tranche: 3, epoch: 2 })))
  const dec = AppendsIndex.Events.codec.tryDecode({ type: "Started", data } as any)
  expect(dec).toEqual({ type: "Started", data: { partition: 3, epoch: 2 } })
})

test("Roundtrips Started cleanly", () => {
  const event: AppendsIndex.Events.Event = {
    type: "Started",
    data: { partition: AppendsPartitionId.wellKnownId, epoch: AppendsEpochId.parse("3") },
  }
  const enc = AppendsIndex.Events.codec.encode(event, null)
  const dec = AppendsIndex.Events.codec.tryDecode(enc as any)
  expect(dec).toEqual(event)
})
test("Roundtrips Snapshotted cleanly", () => {
  const event: AppendsIndex.Events.Event = {
    type: "Snapshotted",
    data: { active: { [AppendsPartitionId.parse("0")]: AppendsEpochId.parse("2") } },
  }
  const enc = AppendsIndex.Events.codec.encode(event, null)
  const dec = AppendsIndex.Events.codec.tryDecode(enc as any)
  expect(dec).toEqual(event)
})

/*
[<FsCheck.Xunit.Property>]
let roundtrips value =
let e = Events.codec.Encode((), value)
let t = FsCodec.Core.TimelineEvent.Create(-1L, e.EventType, e.Data)
let decoded = Events.codec.TryDecode t
test <@ ValueSome value = decoded @>
*/
