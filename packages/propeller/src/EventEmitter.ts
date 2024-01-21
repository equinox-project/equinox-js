import EventEmitter from "events"

export function waitForEvent(emitter: EventEmitter, event: string, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => emitter.once(event, () => resolve()))
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(new Error("Aborted"))
    }
    signal.addEventListener("abort", abort)
    emitter.once(event, () => {
      signal.removeEventListener("abort", abort)
      resolve()
    })
  })
}
