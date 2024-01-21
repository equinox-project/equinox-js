export class Semaphore {
  constructor(private readonly max: number) {}
  private count = 0

  tryTake(): boolean {
    if (this.count >= this.max) return false
    this.count++
    return true
  }

  release() {
    this.count--
  }
}
