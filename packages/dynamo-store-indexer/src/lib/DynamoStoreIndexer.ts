import { CachingStrategy, DynamoStoreContext } from "@equinox-js/dynamo-store"
import { MemoryCache } from "@equinox-js/core"
import * as AppendsEpoch from "./AppendsEpoch"
import * as AppendsIndex from "./AppendsIndex"
import * as ExactlyOnceIngester from "./ExactlyOnceIngester"
import { AppendsEpochId, AppendsTrancheId, IndexStreamId } from "./Types"

type Ingester = ExactlyOnceIngester.Service<AppendsEpochId.t, AppendsEpoch.Events.StreamSpan, IndexStreamId.t, IndexStreamId.t>
export class DynamoStoreIndexer {
  ingester: (trancheId: AppendsTrancheId.t) => Ingester
  constructor(
    private readonly context: DynamoStoreContext,
    private readonly cache: CachingStrategy.CachingStrategy,
    private readonly epochBytesCutoff: number,
    private readonly maxStreams = 100_000,
    private readonly maxVersion = 5_000n
  ) {
    if (maxStreams > AppendsEpoch.maxItemsPerEpoch) throw new Error(`"maxVersion" Cannot exceed AppendsEpoch.MaxItemsPerEpoch`)

    const makeIngesterFactory = () => {
      const epochs = AppendsEpoch.Config.create(epochBytesCutoff, maxVersion, maxStreams, context, cache)
      const index = AppendsIndex.Config.create(context, cache)
      const createIngester = (trancheId: AppendsTrancheId.t) => {
        let readIngestionEpoch = () => index.readIngestionEpochId(trancheId)
        let markIngestionEpoch = (epochId: AppendsEpochId.t) => index.markIngestionEpoch(trancheId, epochId)
        let ingest = (eid: AppendsEpochId.t, items: AppendsEpoch.Events.StreamSpan[]) => epochs.ingest(trancheId, eid, items)
        return ExactlyOnceIngester.create(readIngestionEpoch, markIngestionEpoch, ingest, (s) => s)
      }

      const ingesterForTranche = new Map<AppendsTrancheId.t, Ingester>()
      return (trancheId: AppendsTrancheId.t) => {
        const maybeIngester = ingesterForTranche.get(trancheId)
        if (maybeIngester != null) return maybeIngester
        const ingester = createIngester(trancheId)
        ingesterForTranche.set(trancheId, ingester)
        return ingester
      }
    }
    this.ingester = makeIngesterFactory()
  }

  async ingestWithoutConcurrency(trancheId: AppendsTrancheId.t, spans: AppendsEpoch.Events.StreamSpan[]) {
    const ingester = this.ingester(trancheId)
    const originEpoch = await ingester.activeIngestionEpochId()
    return ingester.ingestMany(originEpoch, spans)
  }
}

export class DynamoStoreIngester {
  // Values up to 5 work reasonably, but side effects are:
  // - read usage is more 'lumpy'
  // - readers need more memory to hold the state
  // - Lambda startup time increases
  private readonly epochCutoffMiB = 1
  private readonly maxCacheMiB = 5

  // Should be large enough to accomodate state of 2 epochs
  // Note the backing memory is not preallocated, so the effects of this being too large will not be immediately apparent
  // (Overusage will hasten the Lambda being killed due to excess memory usage)
  private cache = new MemoryCache(10)

  public service: DynamoStoreIndexer
  constructor(context: DynamoStoreContext) {
    this.service = new DynamoStoreIndexer(
      context,
      { type: "SlidingWindow", windowInMs: 20 * 60 * 1000, cache: this.cache },
      this.epochCutoffMiB * 1024 * 1024
    )
  }
}
