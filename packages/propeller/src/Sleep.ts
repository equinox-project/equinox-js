import { setTimeout } from "timers/promises"

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return setTimeout(ms, undefined, { signal })
}
