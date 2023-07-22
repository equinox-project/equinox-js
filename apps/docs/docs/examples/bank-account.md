# Bank Account

```ts
import * as Mdb from "@equinox-js/message-db"
import * as Mem from "@equinox-js/memory-store"

export const Category = "Account"

export type Event =
  | { type: 'Deposited', data: { amount: number } }
  | { type: 'Withdrawn', data: { amount: number } }
export type State = number
export const initial: State = 0
export const evolve = (state: State, event: Event): State => {
  switch (event.type) {
    case "Deposited":
      return state + event.data.amount
    case "Withdrawn":
      return state - event.data.amount
  }
}
export const fold = (state: State, events: Event[]) => events.reduce(evolve, state)

// Don't be frightened by the use of a namespace here. They're a honkin' great idea.
export namespace Decide {
  export const deposit = (amount: number) => (state: State): Event[] => {
    return [{ type: 'Deposited', data: { amount } }]
  }
  export const withdraw = (amount: number) => (state: State): Event[] => {
    if (state > amount) return [{ type: 'Withdrawn', data: { amount } }]
    throw new Error('Insufficient funds')
  }
}

export class Service {
  constructor(private readonly resolve: (accountId: string) => Decider<Event, State>) {
  }

  deposit(accountId: string, amount: number) {
    const decider = this.resolve(accountId)
    return decider.transact(Decide.deposit(amount))
  }

  withdraw(accountId: string, amount: number) {
    const decider = this.resolve(accountId)
    return decider.transact(Decide.withdraw(amount))
  }

  readBalance(accountId: string) {
    const decider = this.resolve(accountId)
    return decider.query(state => state)
  }

  static createMessageDb(context: Mdb.MessageDbContext, caching: Mdb.CachingStrategy) {
    const category = Mdb.MessageDbCategory.create(context, codec, fold, initial, caching)
    const resolve = (stayId: GuestStayId) => Decider.resolve(category, Category, streamId(stayId), null)
    return new Service(resolve)
  }

  static createMem(store: Mem.VolatileStore<Record<string, any>>) {
    const category = Mem.MemoryStoreCategory.create(store, codec, fold, initial)
    const resolve = (stayId: GuestStayId) => Decider.resolve(category, Category, streamId(stayId), null)
    return new Service(resolve)
  }
}
```
