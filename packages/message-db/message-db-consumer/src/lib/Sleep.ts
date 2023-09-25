import {setTimeout} from "timers/promises"

export function sleep(dueTime: number, signal: AbortSignal) {
  return setTimeout(dueTime, undefined, { signal })
}
