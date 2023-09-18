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
