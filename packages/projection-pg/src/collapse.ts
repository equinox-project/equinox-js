import { Action, Change, Insert, Update, Upsert } from "./types"

// Note: do not run prettier over this file, it does a bad job and makes it harder to read

function concat(a: Change, b: Change): Change | undefined {
  switch (a.type) {
    case Action.Insert:
      switch (b.type) {
        case Action.Insert: throw new Error("Cannot insert the same record twice, use Upsert")
        case Action.Update:
        case Action.Upsert: return Insert({ ...a.data, ...b.data })
        case Action.Delete: return undefined
      }
    case Action.Update:
      switch (b.type) {
        case Action.Insert: throw new Error("Cannot insert after updating the same record, use Upsert")
        case Action.Update: return Update({ ...a.data, ...b.data })
        case Action.Upsert:
        case Action.Delete: return b
      }
    case Action.Upsert:
      switch (b.type) {
        case Action.Insert: throw new Error("Cannot insert after upserting the same record, use Upsert")
        case Action.Update:
        case Action.Upsert: return Upsert({ ...a.data, ...b.data })
        case Action.Delete: return b
      }
    case Action.Delete:
      switch (b.type) {
        case Action.Insert: return Update(b.data)
        case Action.Update: throw new Error("Cannot update after deleting the same record, use Upsert")
        case Action.Upsert:
        case Action.Delete: return b
      }
  }
}

export function collapseChanges(changes: Change[]): Change | undefined {
  if (changes.length <= 1) return changes[0]

  let result = changes[0]

  for (let i = 1; i < changes.length; i++) {
    const res = concat(result, changes[i])
    // an undefined means we've zeroed out the change so we skip
    if (res == null) { result = changes[i + 1]; i++; continue; }
    result = res
  }
  return result
}
