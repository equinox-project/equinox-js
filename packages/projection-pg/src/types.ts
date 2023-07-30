export enum Action {
  Insert,
  Update,
  Delete,
  Upsert,
}

type Item = Record<string, any>

export type Change =
  | { type: Action.Insert; data: Item }
  | { type: Action.Update; data: Item }
  | { type: Action.Delete; data: Item }
  | { type: Action.Upsert; data: Item }

export const Insert = (data: Item): Change => ({ type: Action.Insert, data })
export const Update = (data: Item): Change => ({ type: Action.Update, data })
export const Delete = (data: Item): Change => ({ type: Action.Delete, data })
export const Upsert = (data: Item): Change => ({ type: Action.Upsert, data })

export const forEntity = <T extends Item, Id extends keyof T>() => {
  const Insert = (data: T): Change => ({ type: Action.Insert, data })
  const Update = (data: Pick<T, Id> & Partial<T>): Change => ({ type: Action.Update, data })
  const Delete = (data: Pick<T, Id> & Partial<T>): Change => ({ type: Action.Delete, data })
  const Upsert = (data: T): Change => ({ type: Action.Upsert, data })

  return { Insert, Update, Delete, Upsert }
}
