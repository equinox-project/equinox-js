export class Semaphore {
  constructor(private readonly max: number) {}
  private count = 0

  tryTake(): boolean {
    if (this.count < this.max) {
      this.count++
      return true
    }
    return false
  }

  release() {
    this.count--
  }
}
