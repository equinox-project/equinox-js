export const linkSignal = (ctrl: AbortController, signal: AbortSignal) => {
  const abort = () => ctrl.abort()
  signal.addEventListener("abort", abort)
  ctrl.signal.addEventListener("abort", () => {
    signal.removeEventListener("abort", abort)
  })
}
