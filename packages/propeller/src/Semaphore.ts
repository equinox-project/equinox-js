import { Queue } from "./Queue.js"
import { resolveOrAbort } from "./AbortSignal.js"

export class Semaphore {
  constructor(private readonly max: number) {}
  private count = 0
  private waiters = new Queue<() => void>()

  private wait(signal: AbortSignal): Promise<void> {
    return resolveOrAbort(signal, (resolve) => {
      this.waiters.add(resolve)
    })
  }

  private next() {
    if (this.waiters.size > 0) {
      const waiter = this.waiters.tryGet()!
      this.count++
      waiter()
    }
  }

  tryTake(): boolean {
    if (this.count < this.max) {
      this.count++
      return true
    }
    return false
  }

  acquire(signal: AbortSignal): Promise<void> | void {
    if (this.count < this.max) {
      this.count++
      return
    }
    return this.wait(signal)
  }

  release() {
    this.count--
    this.next()
  }
}
