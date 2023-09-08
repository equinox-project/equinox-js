import { test, expect } from "vitest"
import { Events, Fold, Ingest } from "./AppendsEpoch.js"
import { IndexStreamId } from "./Identifiers"

type StreamSpan = Events.StreamSpan

const mkSpan = (sn: string, index: number, cases: string[]): StreamSpan => ({
  p: IndexStreamId.ofString(sn),
  i: index,
  c: cases,
})
const mkSpanA = (sn: string, index: number, cases: string[]): StreamSpan[] => [
  mkSpan(sn, index, cases),
]
const decideIngest = (
  shouldClose: (i: number) => boolean,
  spans: StreamSpan[],
  state: Fold.State,
) => {
  const [result, events] = Ingest.decide(shouldClose, spans, state)
  return [[result.accepted, result.residual], events] as const
}

const decideIngest10 = (spans: StreamSpan[], state: Fold.State) =>
  decideIngest((i) => i > 10, spans, state)

test("residual span shouldn't be affected by earlier events in closed spans", () => {
  const spans1 = mkSpanA("Cat-Id", 0, ["a"])
  const spans2 = mkSpanA("Cat-Id", 1, ["b"])
  const spans3 = mkSpanA("Cat-Id", 2, ["c"])

  const [, events1] = decideIngest10(spans1, Fold.initial)
  const epoch1Closed = Fold.withClosed(Fold.fold(Fold.initial, events1))

  const [, events2] = decideIngest10(spans2, Fold.initial)
  const epoch2Open = Fold.fold(Fold.initial, events2)

  const [[, residual1]] = decideIngest10(spans3, epoch1Closed)
  const [[accepted2, residual2]] = decideIngest10(residual1, epoch2Open)
  expect(residual1).toEqual(spans3)
  expect(accepted2).toEqual(spans3.map((x) => x.p))
  expect(residual2).toEqual([])
})

test("Already ingested events should be removed by ingestion on closed epoch", () => {
  const spans1 = mkSpanA("Cat-Id", 0, ["a", "a"])
  const spans2 = mkSpanA("Cat-Id", 1, ["a", "b"])

  const [, events1] = decideIngest10(spans1, Fold.initial)
  const epoch1Closed = Fold.withClosed(Fold.fold(Fold.initial, events1))

  const [[accepted, residual]] = decideIngest10(spans2, epoch1Closed)
  expect(accepted).toEqual([])
  expect(residual).toEqual(mkSpanA("Cat-Id", 2, ["b"]))
})

test("Already ingested events are not ingested on open epoch", () => {
  const sn = "Cat-Id"
  const spans1 = mkSpanA(sn, 0, ["a", "a"])
  const spans2 = mkSpanA(sn, 1, ["a", "b"])

  const [, events1] = decideIngest10(spans1, Fold.initial)
  const epoch1Open = Fold.fold(Fold.initial, events1)
  const [[accepted], events] = decideIngest10(spans2, epoch1Open)
  expect(accepted).toEqual([sn])
  expect(events).toEqual([{ type: "Ingested", data: { add: [], app: mkSpanA(sn, 2, ["b"]) } }])
})

test("Throws on gap", () => {
  const sn = "Cat-Id"
  const spans1 = mkSpanA(sn, 0, ["a"])
  const spans2 = mkSpanA(sn, 2, ["b"])

  const [, events1] = decideIngest10(spans1, Fold.initial)
  const epoch1Open = Fold.fold(Fold.initial, events1)

  expect(() => decideIngest10(spans2, epoch1Open)).toThrow(/Invalid gap of 1 at 2 in "Cat-Id"/)
})
