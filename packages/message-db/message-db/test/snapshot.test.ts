import { Codec, ITimelineEvent } from "@equinox-js/core"
import { randomUUID } from "crypto"
import { test, expect } from "vitest"
import * as Snapshot from "../src/lib/Snapshot.js"
import * as Token from "../src/lib/Token.js"

const createEvent = (meta: Snapshot.Meta): ITimelineEvent => ({
  id: randomUUID(),
  index: 0n,
  isUnfold: true,
  size: 0,
  time: new Date(),
  type: "Snapshotted",
  data: JSON.stringify({ hello: "world" }),
  meta: JSON.stringify(meta),
})

test("Properly loads snapshot version from previous schema", async () => {
  const event = createEvent({ streamVersion: "10" })
  const codec = Codec.json<any>()

  const decoded = Snapshot.decode(codec.decode, [event])
  if (decoded == null) throw new Error("Expected snapshot to be decoded")
  const [token, value] = decoded
  expect(Token.version(token)).toBe(11n)
  expect(value).toEqual({ type: "Snapshotted", data: { hello: "world" } })
})

test("Properly loads snapshot version from new schema", async () => {
  const event = createEvent({ version: "10" })
  const codec = Codec.json<any>()

  const decoded = Snapshot.decode(codec.decode, [event])
  if (decoded == null) throw new Error("Expected snapshot to be decoded")
  const [token, value] = decoded
  expect(Token.version(token)).toBe(10n)
  expect(value).toEqual({ type: "Snapshotted", data: { hello: "world" } })
})
