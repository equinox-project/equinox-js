export enum Action {
  Update,
  Insert,
  Delete,
  Upsert,
}

export type Change<T extends Record<string, any>, Ids extends keyof T> =
  | { type: Action.Update; data: Pick<T, Ids> & Partial<T> }
  | { type: Action.Insert; data: T }
  | { type: Action.Delete; data: Pick<T, Ids> }
  | { type: Action.Upsert; data: T }

export const Update = <T extends Record<string, any>, Ids extends keyof T>(
  data: Pick<T, Ids> & Partial<T>,
): Change<T, Ids> => ({ type: Action.Update, data })
export const Insert = <T extends Record<string, any>>(data: T): Change<T, keyof T> => ({
  type: Action.Insert,
  data,
})
export const Delete = <T extends Record<string, any>, Ids extends keyof T>(
  data: Pick<T, Ids>,
): Change<T, Ids> => ({ type: Action.Delete, data })
export const Upsert = <T extends Record<string, any>>(data: T): Change<T, keyof T> => ({
  type: Action.Upsert,
  data,
})
