---
sidebar_position: 1
---

# Getting started

EquinoxJS is a ground-up re-implementation of the Equinox project, an F# event sourcing library. It provides a
programming model centered around Deciders as the central domain abstraction.

# Quick example

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
    const category = Mdb.MessageDbCategory.create(context, Category, codec, fold, initial, caching)
    const resolve = (stayId: GuestStayId) => Decider.forStream(category, streamId(stayId), null)
    return new Service(resolve)
  }

  static createMem(store: Mem.VolatileStore<string>) {
    const category = Mem.MemoryStoreCategory.create(store, Category, codec, fold, initial)
    const resolve = (stayId: GuestStayId) => Decider.forStream(category, streamId(stayId), null)
    return new Service(resolve)
  }
}
```

# Testing

When testing you can either test the constituent parts of the decider by wiring them up yourself

```ts
const given = (events: Event[], interpret: (state: State) => Event[]) => interpret(fold(initial, events))

test("Depositing", () => {
  expect(given([], Decide.deposit(100))).toEqual([{ type: "Deposited", data: { amount: 100 } }])
})

test("Withdrawing with no funds", () => {
  expect(() => given([], Decide.withdraw(100))).toThrow("Insufficient funds")
})

test("Withdrawing with funds", () => {
  expect(given([{ type: "Deposited", data: { amount: 100 } }], Decide.withdraw(50))).toEqual([{
    type: "Withdrawn",
    data: { amount: 50 }
  }])
})
```

Or you can test it through the `Service` using the included memory store.

```ts
import { VolatileStore } from '@equinox-js/memory-store'

const createService = () => {
  const store = new VolatileStore<Record<string, any>>()
  return Service.createMem(store)
}

test('Depositing', async () => {
  const service = createService()
  await service.deposit('1', 100)
  expect(await service.readBalance('1')).toEqual(100)
})

test('Withdrawing without funds', async () => {
  const service = createService()
  await expect(service.withdraw('1', 100)).rejects.toThrow('Insufficient funds')
})

test('Withdrawing with funds', async () => {
  const service = createService()
  await service.deposit('1', 100)
  await service.withdraw('1', 25)
  expect(await service.readBalance('1')).toEqual(75)
})
```
