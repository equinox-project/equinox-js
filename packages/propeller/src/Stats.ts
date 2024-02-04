import { trace } from "@opentelemetry/api"
import { Batch } from "./Types.js"
import EventEmitter from "events"

const tracer = trace.getTracer("@equinox-js/propeller")

type Stat = {
  pagesRead: number
  pagesEmpty: number
  eventsRead: number
  isAtTail: boolean
  batchLastPosition: number
  completedPosition: number
}

namespace Stat {
  export const empty = (): Stat => ({
    pagesRead: 0,
    pagesEmpty: 0,
    eventsRead: 0,
    isAtTail: false,
    batchLastPosition: -1,
    completedPosition: -1,
  })

  export const reset = (stat: Stat) => {
    stat.pagesRead = 0
    stat.pagesEmpty = 0
    stat.eventsRead = 0
    return stat
  }
}
export class Stats extends EventEmitter {
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
    this.emit("ingested", {
      trancheId,
      checkpoint: batch.checkpoint,
      isTail: batch.isTail,
      events: batch.items.length,
    })
  }

  recordCompletion(trancheId: string, checkpoint: bigint) {
    const stat = this.getStat(trancheId)
    stat.completedPosition = Number(checkpoint)
    this.emit("completed", { trancheId, checkpoint })
  }

  dump() {
    for (const [trancheId, stat] of this.stats) {
      tracer
        .startSpan("propeller.metrics", {
          attributes: {
            "metrics.eqx.tranche_id": trancheId,
            "metrics.eqx.pages_read": stat.pagesRead,
            "metrics.eqx.pages_empty": stat.pagesEmpty,
            "metrics.eqx.events_read": stat.eventsRead,
            "metrics.eqx.at_tail": stat.isAtTail,
            "metrics.eqx.batch_checkpoint": stat.batchLastPosition,
            "metrics.eqx.processed_checkpoint": stat.completedPosition,
          },
        })
        .end()
      Stat.reset(stat)
    }
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
