export type IngestResult<Req, Res> = { accepted: Res[]; closed: boolean; residual: Req[] }

namespace Internal {
  export const unknown = <T extends number>() => -1 as T
  export const next = <T extends number>(x: T): T => (x + 1) as T
}

export class Service<EpochId extends number, Req, Res, Out> {
  constructor(
    private readonly readActiveEpoch: () => Promise<EpochId>,
    private readonly markActiveEpoch: (n: EpochId) => Promise<null>,
    private readonly ingest: (epoch: EpochId, reqs: Req[]) => Promise<IngestResult<Req, Res>>,
    private readonly mapResults: (res: Res[]) => Out[]
  ) {}

  private uninitializedSentinel = Internal.unknown<EpochId>()
  private currentEpochId_ = this.uninitializedSentinel

  private currentEpochId() {
    if (this.currentEpochId_ !== this.uninitializedSentinel) return this.currentEpochId_
    return undefined
  }

  private async walk_(ingestedItems: Res[], items: [EpochId, Req][]): Promise<Res[]> {
    const epochId = items.reduce((p, v) => Math.min(p, v[0]), Infinity) as EpochId
    const epochItems: Req[] = []
    const futureEpochItems: [EpochId, Req][] = []

    for (let i = 0; i < items.length; ++i) {
      const e = items[i][0]
      if (e === epochId) epochItems.push(items[i][1])
      else futureEpochItems.push(items[i])
    }
    const res = await this.ingest(epochId, epochItems)
    const ingestedItemIds = ingestedItems.concat(res.accepted)
    const nextEpochId = Internal.next(epochId)
    const remaining = res.residual.map((x): [EpochId, Req] => [nextEpochId, x]).concat(futureEpochItems)
    if (remaining.length > 0) return this.walk_(ingestedItemIds, remaining)
    // Any writer noticing we've moved to a new Epoch shares the burden of marking it active in the Series
    const newActiveEpochId = res.closed ? nextEpochId : epochId
    if (this.currentEpochId_ < newActiveEpochId) {
      await this.markActiveEpoch(newActiveEpochId)
      this.currentEpochId_ = newActiveEpochId
    }
    return ingestedItemIds
  }

  private walk(items: [EpochId, Req][]) {
    return this.walk_([], items)
  }

  async ingestMany(originEpoch: EpochId, reqs: Req[]): Promise<Out[]> {
    if (reqs.length === 0) return []
    const results = await this.walk(reqs.map((x) => [originEpoch, x]))
    return this.mapResults(results)
  }

  async activeIngestionEpochId(): Promise<EpochId> {
    const epoch = this.currentEpochId()
    if (epoch == null) return this.readActiveEpoch()
    return epoch
  }
}

export const create = <EpochId extends number, Req, Res, Out>(
  readIngestionEpoch: () => Promise<EpochId>,
  markIngestionEpoch: (n: EpochId) => Promise<null>,
  ingest: (epoch: EpochId, reqs: Req[]) => Promise<IngestResult<Req, Res>>,
  mapResult: (res: Res[]) => Out[]
) => {
  return new Service(readIngestionEpoch, markIngestionEpoch, ingest, mapResult)
}
