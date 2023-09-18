export class BoundedChannel<T> {
  private capacity: number
  private queue: T[]
  private pendingGets: { resolve(val: T): void; reject(err: any): void }[]
  private pendingPuts: { item: T; resolve(): void; reject(err: any): void }[]
  constructor(capacity: number) {
    this.capacity = capacity
    this.queue = []
    this.pendingGets = []
    this.pendingPuts = []
  }

  put(item: T) {
    return new Promise<void>((resolve, reject) => {
      if (this.queue.length < this.capacity) {
        this.queue.push(item)
        resolve()

        // If there's any pending get, resolve it
        if (this.pendingGets.length) {
          const { resolve: getResolve, reject: getReject } = this.pendingGets.shift()!
          getResolve(this.queue.shift()!)
        }
      } else {
        // Put this put request in pending if the queue is full
        this.pendingPuts.push({ item, resolve, reject })
      }
    })
  }

  get() {
    return new Promise((resolve, reject) => {
      if (this.queue.length) {
        resolve(this.queue.shift())

        // If there's any pending put, resolve it
        if (this.pendingPuts.length) {
          const { item, resolve: putResolve } = this.pendingPuts.shift()!
          this.queue.push(item)
          putResolve()
        }
      } else {
        // Put this get request in pending if the queue is empty
        this.pendingGets.push({ resolve, reject })
      }
    })
  }
}
