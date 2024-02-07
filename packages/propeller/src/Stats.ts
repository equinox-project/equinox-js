import { trace } from "@opentelemetry/api"
import { Batch } from "./Types.js"
import EventEmitter from "events"
import { setTimeout } from "timers/promises"

const tracer = trace.getTracer("@equinox-js/propeller")

type Stat = {
  pagesRead: number
  pagesEmpty: number
  eventsRead: number
  pendingBatches: number
  isAtTail: boolean
  batchLastPosition: number
  completedPosition: number
}

namespace Stat {
  export const empty = (): Stat => ({
    pagesRead: 0,
    pagesEmpty: 0,
    eventsRead: 0,
    pendingBatches: 0,
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
    if (batch.items.length > 0) {
      stat.pendingBatches++
      this.emit("ingested", {
        trancheId,
        checkpoint: batch.checkpoint,
        isTail: batch.isTail,
        events: batch.items.length,
      })
    } else {
      stat.pagesEmpty++
      // we've received an empty page with no pending batches indicating we're at the tail
      if (stat.pendingBatches === 0) this.emit("tail", { trancheId })
    }
  }

  recordCompletion(trancheId: string, batch: Batch) {
    const stat = this.getStat(trancheId)
    stat.completedPosition = Number(batch.checkpoint)
    stat.pendingBatches--
    this.emit("completed", {
      trancheId,
      checkpoint: batch.checkpoint,
      isTail: batch.isTail,
      pendingBatches: stat.pendingBatches,
    })
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

  /**
   * Waits for all tranches to receive at least one batch
   * and then for that tranche to reach the tail.
   * @param [propagationDelay=0] - The expected time it takes for the appended events to be propagated to the source
   */
  waitForTail(propagationDelay = 0) {
    return new Promise<void>(async (resolve) => {
      const now = Date.now()
      const tranches = new Set(this.stats.keys())
      const completed = new Set<string>()
      const atTail = new Set<string>()
      const checkCompletion = () => {
        if (tranches.size === atTail.size) {
          const currentTime = Date.now()
          const remainingMs = propagationDelay - (currentTime - now)
          if (remainingMs > 0) {
            setTimeout(remainingMs).then(checkCompletion)
          } else {
            this.off("completed", onCompleted)
            this.off("tail", onTail)
            this.off("ingested", onIngested)
            resolve()
          }
        }
      }
      // Sometimes this method is called before we have any known tranches
      // in that case we'll add the new tranche in as they arrive
      const onIngested = (e: { trancheId: string }) => {
        tranches.add(e.trancheId)
        completed.delete(e.trancheId)
        atTail.delete(e.trancheId)
        checkCompletion()
      }
      const onCompleted = (e: { trancheId: string }) => {
        completed.add(e.trancheId)
        checkCompletion()
      }
      const onTail = (e: { trancheId: string }) => {
        if (completed.has(e.trancheId)) {
          atTail.add(e.trancheId)
          checkCompletion()
        }
      }
      this.on("ingested", onIngested)
      this.on("completed", onCompleted)
      this.on("tail", onTail)
    })
  }
}
