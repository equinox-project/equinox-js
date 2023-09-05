import { DynamoStoreContext } from "@equinox-js/dynamo-store"
import { CachingStrategy, ICachingStrategy, MemoryCache } from "@equinox-js/core"
import * as AppendsEpoch from "./AppendsEpoch.js"
import * as AppendsIndex from "./AppendsIndex.js"
import * as ExactlyOnceIngester from "./ExactlyOnceIngester.js"
import { AppendsEpochId, AppendsTrancheId, IndexStreamId } from "./Identifiers.js"

type Ingester = ExactlyOnceIngester.Service<
  AppendsEpochId,
  AppendsEpoch.Events.StreamSpan,
  IndexStreamId,
  IndexStreamId
>
export class DynamoStoreIndexer {
  ingester: (trancheId: AppendsTrancheId) => Ingester
  constructor(
    context: DynamoStoreContext,
    cache: ICachingStrategy | undefined,
    epochBytesCutoff: number,
    maxStreams = 100_000,
    maxVersion = 5_000n,
  ) {
    if (maxStreams > AppendsEpoch.maxItemsPerEpoch)
      throw new Error(`"maxVersion" Cannot exceed AppendsEpoch.MaxItemsPerEpoch`)

    const makeIngesterFactory = () => {
      const epochs = AppendsEpoch.Config.create(
        epochBytesCutoff,
        maxVersion,
        maxStreams,
        context,
        cache,
      )
      const index = AppendsIndex.Service.create(context, cache)
      const createIngester = (trancheId: AppendsTrancheId) => {
        let readIngestionEpoch = () => index.readIngestionEpochId(trancheId)
        let markIngestionEpoch = (epochId: AppendsEpochId) =>
          index.markIngestionEpoch(trancheId, epochId)
        let ingest = (eid: AppendsEpochId, items: AppendsEpoch.Events.StreamSpan[]) =>
          epochs.ingest(trancheId, eid, items)
        return ExactlyOnceIngester.create(readIngestionEpoch, markIngestionEpoch, ingest, (s) => s)
      }

      const ingesterForTranche = new Map<AppendsTrancheId, Ingester>()
      return (trancheId: AppendsTrancheId) => {
        const maybeIngester = ingesterForTranche.get(trancheId)
        if (maybeIngester != null) return maybeIngester
        const ingester = createIngester(trancheId)
        ingesterForTranche.set(trancheId, ingester)
        return ingester
      }
    }
    this.ingester = makeIngesterFactory()
  }

  async ingestWithoutConcurrency(
    trancheId: AppendsTrancheId,
    spans: AppendsEpoch.Events.StreamSpan[],
  ) {
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
  // private readonly maxCacheMiB = 5

  // Should be large enough to accomodate state of 2 epochs
  // Note the backing memory is not preallocated, so the effects of this being too large will not be immediately apparent
  // (Overusage will hasten the Lambda being killed due to excess memory usage)
  private cache = new MemoryCache(10)

  public service: DynamoStoreIndexer
  constructor(context: DynamoStoreContext) {
    this.service = new DynamoStoreIndexer(
      context,
      CachingStrategy.Cache(this.cache),
      this.epochCutoffMiB * 1024 * 1024,
    )
  }
}
