import { Batch, Sink } from "./Types.js"
import { ICheckpoints } from "./Checkpoints.js"
import { Stats } from "./Stats.js"
import { Internal } from "@equinox-js/core"
import EventEmitter from "events"

export class CheckpointWriter {
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
      await Internal.sleep(this.intervalMs, signal)
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

export class TailingFeedSource {
  constructor(private readonly options: TailingFeedSourceOptions) {}
  stats = new Stats()

  private async *crawl(
    trancheId: string,
    wasTail: boolean,
    position: bigint,
    signal: AbortSignal,
  ): AsyncIterable<Batch> {
    if (wasTail) await Internal.sleep(this.options.tailSleepIntervalMs, signal)
    yield* this.options.crawl(trancheId, position, signal)
  }

  private async _start(
    trancheId: string,
    pos: bigint,
    onBatchComplete: (cp: bigint) => void,
    signal: AbortSignal,
  ) {
    const { sink } = this.options

    // we swallow aborts checkpoint errors
    let wasTail = false
    while (!signal.aborted) {
      for await (const _batch of this.crawl(trancheId, wasTail, pos, signal)) {
        // Weird TS bug thinks that batch is any
        const batch: Batch = _batch
        this.stats.recordBatch(trancheId, batch)
        if (batch.items.length !== 0) {
          await sink.pump(
            {
              items: batch.items,
              checkpoint: batch.checkpoint,
              isTail: batch.isTail,
              onComplete: () => {
                this.stats.recordCompletion(trancheId, batch.checkpoint)
                onBatchComplete(batch.checkpoint)
              },
            },
            signal,
          )
        }
        pos = batch.checkpoint
        wasTail = batch.isTail
      }
    }
  }

  async start(trancheId: string, rootSignal: AbortSignal) {
    const ctrl = new AbortController()
    rootSignal.addEventListener("abort", () => !ctrl.signal.aborted && ctrl.abort())
    const signal = ctrl.signal

    if (this.options.statsIntervalMs) {
      this.stats.dumpOnInterval(this.options.statsIntervalMs, signal)
    }

    const { checkpoints, checkpointIntervalMs, groupName, establishOrigin } = this.options
    const pos = await checkpoints.load(groupName, trancheId, establishOrigin)
    const checkpointWriter = new CheckpointWriter(
      groupName,
      trancheId,
      checkpointIntervalMs,
      checkpoints,
      pos,
    )

    const cancelAndThrow = (e: unknown) => {
      if (signal.aborted) return
      ctrl.abort()
      throw e
    }

    const sinkP = this.options.sink.start(signal).catch(cancelAndThrow)
    const checkpointsP = checkpointWriter.start(signal).catch(cancelAndThrow)
    const sourceP = this._start(trancheId, pos, (cp) => checkpointWriter.commit(cp), signal).catch(
      cancelAndThrow,
    )

    await Promise.all([checkpointsP, sinkP, sourceP]).finally(() => checkpointWriter.flush())
  }
}
