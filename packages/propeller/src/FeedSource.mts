import { Batch, Sink } from "./Types.js"
import { ICheckpoints } from "./Checkpoints.js"
import { sleep } from "./Sleep.js"
import { Stats } from "./Stats.js"
import EventEmitter from "events"

class CheckpointWriter {
  constructor(
    private readonly groupName: string,
    private readonly trancheId: string,
    private readonly intervalMs: number,
    private readonly checkpoints: ICheckpoints,
    private committedPos: bigint,
    private validatedPos = committedPos,
  ) {}

  async start(signal: AbortSignal) {
    while (!signal.aborted) {
      await sleep(this.intervalMs, signal)
      await this.flush()
    }
  }

  async flush() {
    if (this.committedPos !== this.validatedPos) {
      const pos = this.validatedPos
      this.committedPos = pos
      await this.checkpoints.commit(this.groupName, this.trancheId, pos)
    }
  }

  commit(pos: bigint) {
    this.validatedPos = pos
  }
}

export type TailingFeedSourceOptions = {
  statsIntervalMs?: number
  tailSleepIntervalMs: number
  checkpointIntervalMs: number
  groupName: string
  checkpoints: ICheckpoints
  sink: Sink
  crawl: (trancheId: string, position: bigint, signal: AbortSignal) => AsyncIterable<Batch>
  establishOrigin?: (tranche: string) => Promise<bigint>
}

export class TailingFeedSource extends EventEmitter {
  onError!: (err: any) => void
  constructor(private readonly options: TailingFeedSourceOptions) {
    super()
  }
  stats = new Stats()

  private async *crawl(
    trancheId: string,
    wasTail: boolean,
    position: bigint,
    signal: AbortSignal,
  ): AsyncIterable<Batch> {
    if (wasTail) {
      this.emit("tail", { trancheId, position })
      await sleep(this.options.tailSleepIntervalMs, signal)
    }
    yield* this.options.crawl(trancheId, position, signal)
  }

  private async _start(trancheId: string, signal: AbortSignal) {
    const { checkpoints, checkpointIntervalMs, groupName, establishOrigin, sink } = this.options
    let pos = await checkpoints.load(groupName, trancheId, establishOrigin)
    const checkpointWriter = new CheckpointWriter(
      groupName,
      trancheId,
      checkpointIntervalMs,
      checkpoints,
      pos,
    )
    checkpointWriter.start(signal).catch(this.onError)
    // flush the checkpoint on abort
    signal.addEventListener("abort", () => {
      checkpointWriter.flush()
    })
    let wasTail = false
    while (!signal.aborted) {
      for await (const _batch of this.crawl(trancheId, wasTail, pos, signal)) {
        // Weird TS bug thinks that batch is any
        const batch: Batch = _batch
        this.stats.recordBatch(trancheId, batch)
        if (batch.items.length !== 0) {
          this.emit("batch", {
            trancheId,
            position: batch.checkpoint,
            items_count: batch.items.length,
          })
          await sink.pump(
            {
              items: batch.items,
              checkpoint: batch.checkpoint,
              isTail: batch.isTail,
              onComplete: () => checkpointWriter.commit(batch.checkpoint),
            },
            signal,
          )
        } else {
          this.emit("empty", { trancheId, position: batch.checkpoint })
        }
        pos = batch.checkpoint
        wasTail = batch.isTail
      }
    }
  }

  start(trancheId: string, signal: AbortSignal) {
    if (this.options.statsIntervalMs) {
      this.stats.dumpOnInterval(this.options.statsIntervalMs, signal)
    }
    return new Promise<void>((resolve, reject) => {
      this.onError = (err: any) => {
        if (err && err.message === "Aborted") return resolve()
        reject(err)
      }
      const sinkPromise = this.options.sink.start?.(signal)
      const sourcePromise = this._start(trancheId, signal)
      Promise.all([sinkPromise, sourcePromise]).then(() => resolve(), this.onError)
    })
  }
}
