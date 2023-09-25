import { Attributes, trace } from "@opentelemetry/api"
import { Batch } from "./Types.js"

const tracer = trace.getTracer("@equinox-js/propeller")

type Stat = {
  pagesRead: number
  pagesEmpty: number
  eventsRead: number
  isAtTail: boolean
  batchLastPosition: number
}

namespace Stat {
  export const empty = (): Stat => ({
    pagesRead: 0,
    pagesEmpty: 0,
    eventsRead: 0,
    isAtTail: false,
    batchLastPosition: -1,
  })

  export const reset = (stat: Stat) => {
    stat.pagesRead = 0
    stat.pagesEmpty = 0
    stat.eventsRead = 0
    return stat
  }
}
export class Stats {
  stats = new Map<string, Stat>()

  private getStat(key: string): Stat {
    const current = this.stats.get(key)
    if (current) return current
    const stat = Stat.empty()
    this.stats.set(key, stat)
    return stat
  }

  recordBatch(trancheId: string, batch: Batch) {
    const stat = this.getStat(trancheId)

    stat.isAtTail = batch.isTail
    stat.batchLastPosition = Number(batch.checkpoint)
    stat.pagesRead++
    stat.eventsRead += batch.items.length
    if (batch.items.length === 0) stat.pagesEmpty++
  }

  dump() {
    const attributes: Attributes = {}
    let pagesRead = 0
    let pagesEmpty = 0
    let eventsRead = 0
    for (const [trancheId, stat] of this.stats) {
      pagesRead += stat.pagesRead
      pagesEmpty += stat.pagesEmpty
      eventsRead += stat.eventsRead
      attributes[`eqx.metric.${trancheId}.pages_read`] = stat.pagesRead
      attributes[`eqx.metric.${trancheId}.pages_empty`] = stat.pagesEmpty
      attributes[`eqx.metric.${trancheId}.events_read`] = stat.eventsRead
      attributes[`eqx.metric.${trancheId}.at_tail`] = stat.isAtTail
      attributes[`eqx.metric.${trancheId}.batch_checkpoint`] = stat.batchLastPosition
      Stat.reset(stat)
    }
    attributes["eqx.metric.pages_read"] = pagesRead
    attributes["eqx.metric.pages_empty"] = pagesEmpty
    attributes["eqx.metric.events_read"] = eventsRead

    tracer.startSpan("propeller.metric", { attributes }).end()
  }

  dumpOnInterval(intervalMs: number, signal: AbortSignal) {
    const interval = setInterval(() => {
      this.dump()
    }, intervalMs)
    signal.addEventListener("abort", () => {
      clearInterval(interval)
    })
  }
}
