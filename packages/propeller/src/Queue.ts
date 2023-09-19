class Node<T> {
  value: T
  next?: Node<T>
  constructor(value: T) {
    this.value = value
  }
}

export class Queue<T> {
  private firstAndLast?: [Node<T>, Node<T>]
  size = 0

  add(value: T) {
    const node = new Node(value)

    if (this.firstAndLast) {
      this.firstAndLast[1].next = node
      this.firstAndLast = [this.firstAndLast[0], node]
    } else {
      this.firstAndLast = [node, node]
    }

    this.size++
  }

  tryGet() {
    if (this.firstAndLast) {
      const value = this.firstAndLast[0].value
      if (this.firstAndLast[0].next) {
        this.firstAndLast = [this.firstAndLast[0].next, this.firstAndLast[1]]
      } else {
        delete this.firstAndLast
      }
      return value
    }
  }
}

export class AsyncQueue<T> {
  private queue = new Queue<T>()
  private pendingGets = new Queue<(value: T) => void>()

  add(value: T) {
    const send = this.pendingGets.tryGet()
    if (send) return send(value)
    this.queue.add(value)
  }

  tryGetAsync(signal: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
      const value = this.queue.tryGet()
      if (value) return resolve(value)
      const abort = () => reject(new Error("Aborted"))
      if (signal.aborted) return abort()
      signal.addEventListener("abort", abort)
      this.pendingGets.add((value) => {
        signal.removeEventListener("abort", abort)
        setImmediate(() => resolve(value))
      })
    })
  }
}
