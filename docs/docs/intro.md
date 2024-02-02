---
sidebar_position: 1
---

# Getting started

EquinoxJS is a ground-up re-implementation of the Equinox project, an F# event
sourcing library. It provides a programming model centered around Deciders as
the central domain abstraction.

# Install dependencies

You'll need the `core` library in addition to a concrete store library.

```sh
# The core library
pnpm add @equinox-js/core 
# And the concrete store library
pnpm add @equinox-js/memory-store @equinox-js/message-db # or @equinox-js/dynamo-store
```

# Quick example

```ts
import { Decider, StreamId, StreamName, Uuid, Codec, ICache, CachingStrategy } from "@equinox-js/core"
import { MessageDbCategory, MessageDbContext, AccessStrategy } from "@equinox-js/message-db"
import { VolatileStore, MemoryStoreCategory } from "@equinox-js/memory-store"

export type AccountId = Uuid.Uuid<"AccountId">
export const AccountId = Uuid.create<"AccountId">()

export namespace Stream {
  export const category = "Account"
  export const id = StreamId.gen(AccountId.toString)
  export const decodeId = StreamId.dec(AccountId.parse)
  export const match = StreamName.tryMatch(Category, decodeId)
}

export namespace Events {
  export type Amount = { amount: number }
  export type Event = 
    | { type: "Deposited"; data: Amount } 
    | { type: "Withdrawn"; data: Amount }
  export const codec = Codec.json<Event>()
}

export namespace Fold {
  import Event = Events.Event

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
}

export namespace Decide {
  import Event = Events.Event
  import State = Fold.State

  export const deposit =
    (amount: number) =>
    (state: State): Event[] => {
      return [{ type: "Deposited", data: { amount } }]
    }
  export const withdraw =
    (amount: number) =>
    (state: State): Event[] => {
      if (state < amount) throw new Error("Insufficient funds")
      return [{ type: "Withdrawn", data: { amount } }]
    }
}

export class Service {
  constructor(private readonly resolve: (accountId: AccountId) => Decider<Events.Event, Fold.State>) {}

  deposit(accountId: AccountId, amount: number) {
    const decider = this.resolve(accountId)
    return decider.transact(Decide.deposit(amount))
  }

  withdraw(accountId: AccountId, amount: number) {
    const decider = this.resolve(accountId)
    return decider.transact(Decide.withdraw(amount))
  }

  readBalance(accountId: AccountId) {
    const decider = this.resolve(accountId)
    return decider.query((state) => state)
  }

  // Creates a service instance wired up against MessageDB
  static create(context: MessageDbContext, cache: ICache) {
    const caching = CachingStrategy.Cache(cache)
    const access = AccessStrategy.Unoptimized()
    const category = MessageDbCategory.create(context, Stream.category, Events.codec, Fold.fold, Fold.initial, caching, access)
    const resolve = (id: AccountId) => Decider.forStream(category, Stream.id(id), null)
    return new Service(resolve)
  }

  // Creates a service instance wired up against MemoryStore
  static createMem(store: VolatileStore<string>) {
    const category = MemoryStoreCategory.create(store , Stream.category, Events.codec, Fold.fold, Fold.initial)
    const resolve = (id: AccountId) => Decider.forStream(category, Stream.id(id), null)
    return new Service(resolve)
  }
}
```

:::tip

We generally use a project specific `Config` abstraction instead of individual `create` functions.
See [Anatomy](/docs/anatomy#the-config)

:::


# Testing

When testing you can either test the constituent parts of the decider by wiring them up yourself

```ts
import { Fold, Decide } from './service'

const given = (events: Event[], interpret: (state: State) => Event[]) =>
  interpret(Fold.fold(Fold.initial, events))

test("Depositing", () => {
  expect(given([], Decide.deposit(100))).toEqual([{ type: "Deposited", data: { amount: 100 } }])
})

test("Withdrawing with no funds", () => {
  expect(() => given([], Decide.withdraw(100))).toThrow("Insufficient funds")
})

test("Withdrawing with funds", () => {
  expect(given([{ type: "Deposited", data: { amount: 100 } }], Decide.withdraw(50))).toEqual([
    {
      type: "Withdrawn",
      data: { amount: 50 },
    },
  ])
})
```

Or you can test it through the `Service` using the included memory store.

```ts
import { VolatileStore } from "@equinox-js/memory-store"

const createService = () => {
  const store = new VolatileStore<string>()
  return Service.createMem(store)
}

test("Depositing", async () => {
  const service = createService()
  await service.deposit("1", 100)
  expect(await service.readBalance("1")).toEqual(100)
})

test("Withdrawing without funds", async () => {
  const service = createService()
  await expect(service.withdraw("1", 100)).rejects.toThrow("Insufficient funds")
})

test("Withdrawing with funds", async () => {
  const service = createService()
  await service.deposit("1", 100)
  await service.withdraw("1", 25)
  expect(await service.readBalance("1")).toEqual(75)
})
```
