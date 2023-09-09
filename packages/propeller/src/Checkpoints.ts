export interface ICheckpoints {
  commit(groupName: string, tranche: string, position: bigint): Promise<void>
  load(groupName: string, tranche: string, establishOrigin?: () => Promise<bigint>): Promise<bigint>
}
