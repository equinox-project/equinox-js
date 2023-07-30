import { Action, Change, Insert, Update, Upsert } from "./types"

export function collapseChanges<T extends Record<string, any>, Ids extends keyof T>(
  changes: Change<T, Ids>[],
): Change<T, Ids>[] {
  if (changes.length <= 1) return changes

  const first = changes[0]
  const second = changes[1]

  // Insert, Insert
  if (first.type === Action.Insert && second.type === Action.Insert) {
    throw new Error('Cannot insert the same record twice, use Upsert')
  }
  // Insert, Update
  if (first.type === Action.Insert && second.type === Action.Update) {
    return collapseChanges([Insert<T>({ ...first.data, ...second.data }), ...changes.slice(2)])
  }
  // Insert, Upsert: Upsert is a full replace so we can just drop the insert
  if (first.type === Action.Insert && second.type === Action.Upsert) {
    return collapseChanges([second, ...changes.slice(2)])
  }
  // Insert, Delete
  if (first.type === Action.Insert && second.type === Action.Delete) {
    return collapseChanges(changes.slice(2))
  }
  // Update, Insert
  if (first.type === Action.Update && second.type === Action.Insert) {
    throw new Error('Cannot insert after updating the same record, use Upsert')
  }
  // Update, Update
  if (first.type === Action.Update && second.type === Action.Update) {
    return collapseChanges([Update<T, Ids>({ ...first.data, ...second.data }), ...changes.slice(2)])
  }
  // Update, Upsert: Upsert is a full replace so we can just drop the update
  if (first.type === Action.Update && second.type === Action.Upsert) {
    return collapseChanges([second, ...changes.slice(2)])
  }
  // Update, Delete: Update indicates the record exists, so we can drop the update and keep the delete 
  if (first.type === Action.Update && second.type === Action.Delete) {
    return collapseChanges(changes.slice(1))
  }
  // Upsert, Insert
  if (first.type === Action.Upsert && second.type === Action.Insert) {
    throw new Error('Cannot insert after upserting the same record, use Upsert')
  }
  // Upsert, Update
  if (first.type === Action.Upsert && second.type === Action.Update) {
    return collapseChanges([Upsert<T>({...first.data, ...second.data}), ...changes.slice(2)])
  }
  // Upsert, Upsert
  if (first.type === Action.Upsert && second.type === Action.Upsert) {
    return collapseChanges([Upsert<T>({...first.data, ...second.data}), ...changes.slice(2)])
  }
  // Upsert, Delete: We keep the delete
  if (first.type === Action.Upsert && second.type === Action.Delete) {
    return collapseChanges(changes.slice(1))
  }
  // Delete, Insert: Becomes an update 
  if (first.type === Action.Delete && second.type === Action.Insert) {
    return collapseChanges([Update<T, Ids>(second.data), ...changes.slice(2)])
  }
  // Delete, Update
  if (first.type === Action.Delete && second.type === Action.Update) {
    throw new Error('Cannot update after deleting the same record, use Upsert')
  }
  // Delete, Upsert: Keep the upsert
  if (first.type === Action.Delete && second.type === Action.Upsert) {
    return collapseChanges(changes.slice(1))
  }
  // Delete, Delete: Keep the latter delete
  if (first.type === Action.Delete && second.type === Action.Delete) {
    return collapseChanges(changes.slice(1))
  }

  return []
}
