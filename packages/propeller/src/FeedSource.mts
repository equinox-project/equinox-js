import { Batch, Sink } from "./Types.js"
import { ICheckpoints } from "./Checkpoints.js"
import { sleep } from "./Sleep.js"

export class TailingFeedSource {
  constructor(
    private readonly sourceId: string,
    private readonly tailSleepIntervalMs: number,
    private readonly groupName: string,
    private readonly checkpoints: ICheckpoints,
    private readonly sink: Sink,
    private readonly crawl: (
      trancheId: string,
      position: bigint,
      signal: AbortSignal,
    ) => AsyncIterable<Batch>,
    private readonly establishOrigin?: (tranche: string) => Promise<bigint>,
  ) {}

  async start(trancheId: string, signal: AbortSignal) {
    let pos = await this.checkpoints.load(this.groupName, trancheId, this.establishOrigin)
    while (!signal.aborted) {
      for await (const batch of this.crawl(trancheId, pos, signal)) {
        await this.sink.pump(batch)
        if (pos !== batch.checkpoint) {
          await this.checkpoints.commit(this.groupName, trancheId, batch.checkpoint)
          pos = batch.checkpoint
        }
        if (batch.isTail) await sleep(this.tailSleepIntervalMs, signal)
      }
    }
  }
}
