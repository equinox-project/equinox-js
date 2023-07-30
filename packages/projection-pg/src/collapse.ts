import { Action, Change, Insert, Update, Upsert } from "./types"

// Note: do not run prettier over this file, it does a bad job and makes it harder to read

export function collapseChanges(changes: Change[]): Change | undefined {
  if (changes.length <= 1) return changes[0]

  const first = changes[0]
  const second = changes[1]

  switch (first.type) {
    case Action.Insert:
      switch (second.type) {
        case Action.Insert: throw new Error("Cannot insert the same record twice, use Upsert")
        case Action.Update: return collapseChanges([Insert({ ...first.data, ...second.data }), ...changes.slice(2)])
        case Action.Upsert: return collapseChanges([Insert({ ...first.data, ...second.data }), ...changes.slice(2)])
        case Action.Delete: return collapseChanges(changes.slice(2))
      }
    case Action.Update:
      switch (second.type) {
        case Action.Insert: throw new Error("Cannot insert after updating the same record, use Upsert")
        case Action.Update: return collapseChanges([Update({ ...first.data, ...second.data }), ...changes.slice(2)])
        case Action.Upsert: return collapseChanges([second, ...changes.slice(2)])
        case Action.Delete: return collapseChanges(changes.slice(1))
      }
    case Action.Upsert:
      switch (second.type) {
        case Action.Insert: throw new Error("Cannot insert after upserting the same record, use Upsert")
        case Action.Update: return collapseChanges([Upsert({ ...first.data, ...second.data }), ...changes.slice(2)])
        case Action.Upsert: return collapseChanges([Upsert({ ...first.data, ...second.data }), ...changes.slice(2)])
        case Action.Delete: return collapseChanges(changes.slice(1))
      }
    case Action.Delete:
      switch (second.type) {
        case Action.Insert: return collapseChanges([Update(second.data), ...changes.slice(2)])
        case Action.Update: throw new Error("Cannot update after deleting the same record, use Upsert")
        case Action.Upsert: return collapseChanges(changes.slice(1))
        case Action.Delete: return collapseChanges(changes.slice(1))
      }
  }
}
