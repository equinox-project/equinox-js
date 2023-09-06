export function sleep(dueTime: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(new Error("Aborted"))
    }

    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      if (signal.aborted) {
        onAbort()
        return
      }

      resolve()
    }, dueTime)

    signal.addEventListener("abort", onAbort, { once: true })

    function onAbort() {
      clearTimeout(id)
      reject(new Error("Aborted"))
    }
  })
}

