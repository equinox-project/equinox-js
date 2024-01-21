export function resolveOrAbort<T>(
  signal: AbortSignal,
  fn: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Aborted"))
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort)
    fn(value => {
      signal.removeEventListener("abort", abort)
      resolve(value)
    })
  })
}
