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

    ++this.size
  }

  tryGet() {
    if (this.firstAndLast) {
      const value = this.firstAndLast[0].value
      if (this.firstAndLast[0].next) {
        this.firstAndLast = [this.firstAndLast[0].next, this.firstAndLast[1]]
      } else {
        delete this.firstAndLast
      }
      --this.size
      return value
    }
  }

  // prev must not meet the predicate
  private seek(predicate: (x: T) => boolean, prev: Node<T>) {
    let curr = prev.next

    while (curr && !predicate(curr.value)) {
      prev = curr
      curr = curr.next
    }
    if (curr) {
      prev.next = curr.next
      if (this.firstAndLast && this.firstAndLast[1] === curr) this.firstAndLast[1] = prev
      return curr.value
    }
  }

  tryFind(predicate: (x: T) => boolean) {
    if (this.firstAndLast) {
      const head: Node<T> | undefined = this.firstAndLast[0]
      const value = head.value
      if (!predicate(value)) return this.seek(predicate, head)
      if (this.firstAndLast[0].next) {
        this.firstAndLast = [this.firstAndLast[0].next, this.firstAndLast[1]]
      } else {
        delete this.firstAndLast
      }
      --this.size
      return value
    }
  }
}

export class AsyncQueue<T> {
  private queue = new Queue<T>()
  private pendingGets = new Queue<{
    predicate: (value: T) => boolean
    resolve: (value: T) => void
  }>()

  add(value: T) {
    const pending = this.pendingGets.tryGet()
    if (pending && pending.predicate(value)) return pending.resolve(value)
    this.queue.add(value)
  }

  get size() {
    return this.queue.size
  }

  tryFindAsync(predicate: (x: T) => boolean, signal: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
      const value = this.queue.tryFind(predicate)
      if (value) return resolve(value)
      const abort = () => reject(new Error("Aborted"))
      if (signal.aborted) return abort()
      signal.addEventListener("abort", abort)
      this.pendingGets.add({
        predicate,
        resolve(value) {
          signal.removeEventListener("abort", abort)
          resolve(value)
        },
      })
    })
  }
}
