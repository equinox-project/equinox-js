import { Container } from "./Container"
import { Batch, enumEvents } from "./Batch"
import { eventToTimelineEvent, Event } from "./Event"
import { Position, tryFromBatch } from "./Position"
import * as AsyncEnumerable from "./AsyncEnumerable"
import { keepMap } from "./Array"
import { containsBackAsync, tryPick } from "./Array"
import { TimelineEvent } from "@equinox-js/core"
import { ofInternal, EncodedBody } from "./EncodedBody"
import { InternalBody } from "./InternalBody"

export enum Direction {
  Forward,
  Backward,
}

const mkQuery = (
  container: Container,
  stream: string,
  consistentRead: boolean,
  maxItems: number,
  direction: Direction,
  minIndex?: bigint,
  maxIndex?: bigint
) => container.queryBatches(stream, consistentRead, minIndex, maxIndex, direction === Direction.Backward, maxItems)

// Unrolls the Batches in a response
// NOTE when reading backwards, the events are emitted in reverse Index order to suit the takeWhile consumption
const mapPage =
  (
    direction: Direction,
    container: Container,
    stream: string,
    minIndex: bigint | undefined,
    maxIndex: bigint | undefined,
    maxItems: number,
    maxRequests: number | undefined
  ) =>
  ([i, batches]: [number, Batch[]]): [Event[], Position | undefined] => {
    if (maxRequests != null && i >= maxRequests) throw new Error("Batch limit exceeded")
    const unwrapBatch = (x: Batch) => {
      const result = enumEvents(minIndex, maxIndex, x)
      if (direction === Direction.Backward) return result.reverse()
      return result
    }
    const events = batches.flatMap(unwrapBatch)
    const maybePosition = tryPick(tryFromBatch)(batches)
    return [events, maybePosition]
  }

type ScanResult<Event> = {
  found: boolean
  minIndex: bigint
  next: bigint
  maybeTipPos?: Position
  events: Event[]
}

type TryDecode<E> = (e: TimelineEvent<EncodedBody>) => Promise<E | undefined> | E | undefined
export async function scanTip<E>(
  tryDecode: TryDecode<E>,
  isOrigin: (ev: E) => boolean,
  [pos, i, xs]: [Position, bigint, TimelineEvent<InternalBody>[]]
): Promise<ScanResult<E>> {
  const items: E[] = []
  const isOrigin_ = async (ev: TimelineEvent<InternalBody>) => {
    const x = await tryDecode(ofInternal(ev))
    if (x == undefined) return false
    items.unshift(x)
    return isOrigin(x)
  }

  const found = await containsBackAsync(isOrigin_)(xs)

  return {
    found,
    maybeTipPos: pos,
    minIndex: i,
    next: pos.index + 1n,
    events: items,
  }
}

export async function scan<E>(
  container: Container,
  stream: string,
  consistentRead: boolean,
  maxItems: number,
  maxRequests: number | undefined,
  direction: Direction,
  tryDecode: TryDecode<E>,
  isOrigin: (ev: E) => boolean,
  minIndex: bigint | undefined,
  maxIndex: bigint | undefined
): Promise<ScanResult<E> | undefined> {
  let found = false
  let responseCount = 0
  const mergeBatches = async (
    batchesBackward: AsyncIterable<[Event[], Position | undefined]>
  ): Promise<[[Event, E | undefined][], Position | undefined]> => {
    let maybeTipPos: Position | undefined = undefined
    const decodedEvents = AsyncEnumerable.bindArrayAsync(batchesBackward, async ([events, maybePos]) => {
      if (maybeTipPos == null) maybeTipPos = maybePos
      responseCount++
      const result: [Event, E | undefined][] = []
      for (const x of events) result.push([x, await tryDecode(ofInternal(eventToTimelineEvent(x)))])
      return result
    })
    const events = await AsyncEnumerable.toArray(
      AsyncEnumerable.takeWhileInclusive(decodedEvents, ([_, decoded]) => {
        if (!decoded || !isOrigin(decoded)) return true
        found = true
        return false
      })
    )

    return [events, maybeTipPos]
  }
  const batches = AsyncEnumerable.map(
    mkQuery(container, stream, consistentRead, maxItems, direction, minIndex, maxIndex),
    mapPage(direction, container, stream, minIndex, maxIndex, maxItems, maxRequests)
  )
  const [events, maybeTipPos] = await mergeBatches(batches)
  const raws = events.map((x) => x[0])
  const decoded = direction === Direction.Forward ? keepMap(events, (x) => x[1]) : keepMap(events, (x) => x[1]).reverse()
  const minMax = raws.reduce((acc, x): [bigint, bigint] => {
    if (acc == null) return [x.i, x.i]
    return [x.i < acc[0] ? x.i : acc[0], x.i > acc[1] ? x.i : acc[1]]
  }, undefined as [bigint, bigint] | undefined)
  const version = maybeTipPos?.index ?? (minMax ? minMax[1] + 1n : 0n)
  if (minMax) return { found, minIndex: minMax[0], next: minMax[1] + 1n, maybeTipPos, events: decoded }
  if (!minMax && maybeTipPos)
    return {
      found,
      minIndex: maybeTipPos.index,
      next: maybeTipPos.index,
      maybeTipPos,
      events: [],
    }
  return undefined
}

export async function* walkLazy<E>(
  container: Container,
  stream: string,
  maxItems: number,
  maxRequests: number | undefined,
  tryDecode: TryDecode<E>,
  isOrigin: (v: E) => boolean,
  direction: Direction,
  minIndex?: bigint,
  maxIndex?: bigint
): AsyncIterable<E[]> {
  const query = AsyncEnumerable.map(
    mkQuery(container, stream, false, maxItems, direction, minIndex, maxIndex),
    mapPage(direction, container, stream, minIndex, maxIndex, maxItems, maxRequests)
  )

  const allEvents = []
  let i = 0
  let ok = true
  const e = query[Symbol.asyncIterator]()
  while (ok) {
    if (maxRequests && i + 1 >= maxRequests) throw new Error("Batch limit exceeded")
    const more = await e.next()
    if (more.done) break
    const events = more.value[0]
    allEvents.push(...events)
    const acc: E[] = []
    for (const x of events) {
      const decoded = await tryDecode(ofInternal(eventToTimelineEvent(x)))
      if (!decoded) continue
      acc.push(decoded)
      if (isOrigin(decoded)) ok = false
    }
    i++
    yield acc
  }
}

export async function load<E>(
  minIndex: bigint | undefined,
  maxIndex: bigint | undefined,
  tip: ScanResult<E> | undefined,
  primary: (a: bigint | undefined, b: bigint | undefined) => Promise<ScanResult<E> | undefined>,
  fallback: boolean | ((a: bigint | undefined, b: bigint | undefined) => Promise<ScanResult<E> | undefined>)
): Promise<[Position | undefined, E[]]> {
  const minI = minIndex ?? 0n
  if (tip?.found && tip.maybeTipPos) return [tip.maybeTipPos, tip.events]
  if (tip?.maybeTipPos && tip.minIndex <= minI) return [tip.maybeTipPos, tip.events]

  const i = tip?.minIndex ?? maxIndex
  let events = tip?.events ?? []
  const primary_ = await primary(minIndex, i)
  events = primary_ ? primary_.events.concat(events) : events
  const tipPos = tip?.maybeTipPos ?? primary_?.maybeTipPos
  // origin found in primary, no need to look in fallback
  if (primary_?.found) return [tipPos, events]
  // primary had required earliest event Index, no need to look at fallback
  if (primary_ && primary_.minIndex <= minI) return [tipPos, events]
  // initial load where no documents present in stream
  if (!primary_ && tip == null) return [tipPos, events]
  if (typeof fallback === "boolean") {
    const allowMissing = fallback
    if (allowMissing) return [tipPos, events]
    throw new Error("Origin event not found; no Archive Table supplied")
  }
  const fb = await fallback(minIndex, primary_?.minIndex ?? maxIndex)
  const eventsWithFallback = fb?.events.concat(events) ?? events
  return [tipPos, eventsWithFallback]
}
