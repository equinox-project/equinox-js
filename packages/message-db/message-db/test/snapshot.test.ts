import { Codec, ITimelineEvent } from "@equinox-js/core"
import { randomUUID } from "crypto"
import { test, expect } from "vitest"
import * as Snapshot from "../src/lib/Snapshot.js"
import * as Token from "../src/lib/Token.js"

test("Properly loads snapshot version from previous schema", async () => {
  const event: ITimelineEvent = {
    id: randomUUID(),
    index: 0n,
    isUnfold: true,
    size: 0,
    time: new Date(),
    type: "Snapshotted",
    data: JSON.stringify({ hello: "world" }),
    meta: JSON.stringify({ streamVersion: "0" }),
  }

  const codec = Codec.json<any>()

  const decoded = Snapshot.decode(codec.decode, [event])
  if (decoded == null) throw new Error("Expected snapshot to be decoded")
  const [token, value] = decoded
  expect(Token.version(token)).toBe(1n)
  expect(value).toEqual({
    type: "Snapshotted",
    data: { hello: "world" },
  })
})

test("Properly loads snapshot version from new schema", async () => {
  const event: ITimelineEvent = {
    id: randomUUID(),
    index: 0n,
    isUnfold: true,
    size: 0,
    time: new Date(),
    type: "Snapshotted",
    data: JSON.stringify({ hello: "world" }),
    meta: JSON.stringify({ version: "10" }),
  }

  const codec = Codec.json<any>()

  const decoded = Snapshot.decode(codec.decode, [event])
  if (decoded == null) throw new Error("Expected snapshot to be decoded")
  const [token, value] = decoded
  expect(Token.version(token)).toBe(10n)
  expect(value).toEqual({
    type: "Snapshotted",
    data: { hello: "world" },
  })
})
