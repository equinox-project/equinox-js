export interface ICheckpoints {
  commit(groupName: string, tranche: string, position: bigint): Promise<void>
  load(
    groupName: string,
    tranche: string,
    establishOrigin?: (trancheId: string) => Promise<bigint>,
  ): Promise<bigint>
}

export class MemoryCheckpoints implements ICheckpoints {
  checkpoints = new Map<string, bigint>()
  waiters: [string, bigint, () => void][] = []

  async load(groupName: string, category: string, establish?: (t: string) => Promise<bigint>) {
    let value = this.checkpoints.get(`${groupName}:${category}`)
    if (value == null) {
      value = (await establish?.(category)) || 0n
    }
    return value
  }

  async commit(groupName: string, category: string, checkpoint: bigint) {
    const key = `${groupName}:${category}`
    this.checkpoints.set(key, checkpoint)
    for (const [k, v, res] of this.waiters) {
      if (k === key && v <= checkpoint) {
        res()
      }
    }
  }

  waitForCheckpoint(groupName: string,trancheId: string, value: bigint) {
    return new Promise<void>((res) => {
      this.waiters.push([`${groupName}:${trancheId}`, value, res])
    })
  }
}
