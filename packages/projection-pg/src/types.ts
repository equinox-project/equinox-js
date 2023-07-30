export enum Action {
  Insert,
  Update,
  Delete,
  Upsert,
}

type Item = Record<string, any>

export type Change<T extends Item = Item> =
  | { type: Action.Insert; data: T }
  | { type: Action.Update; data: Partial<T> }
  | { type: Action.Delete; data: Partial<T> }
  | { type: Action.Upsert; data: T }

export const Insert = <T extends Item>(data: T): Change<T> => ({ type: Action.Insert, data })
export const Update = <T extends Item>(data: Partial<T>): Change<T> => ({ type: Action.Update, data })
export const Delete = <T extends Item>(data: Partial<T>): Change<T> => ({ type: Action.Delete, data })
export const Upsert = <T extends Item>(data: T): Change<T> => ({ type: Action.Upsert, data })

