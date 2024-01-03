---
sidebar_position: 3
---

# Decider

The best treatment of the concept of a Decider is Jeremie Chassaing's
[post](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider)
on the subject. In EquinoxJS the type `Decider` exposes an API for making
Consistent Decisions against a Store derived from Events on a Stream. As Jeremie
explained in his article, a Decider for a counter whose values must be between 0
and 10 could look like this: 

```ts
type Event = { type: 'Incremented' } | { type: 'Decremented' }
type Command = { type: 'Increment' } | { type: 'Decrement' }
type State = { count: number }
const initial: State = { count: 0 }
const evolve = (state: State, event: Event): State => {
  switch (event.type) {
    case 'Incremented': return { count: state.count + 1 }
    case 'Decremented': return { count: state - 1 }
  }
}
const decide = (command: Command, state: State): Event[] => {
  switch (command.type) {
    case 'Increment': 
      if (state.count < 10) return [{ type: 'Incremented'  }]
      return []

    case 'Decrement': 
      if (state.count > 0) return [{ type: 'Decremented'  }]
      return []
  }
}
```

You could use the decider pattern as-is with Equinox by wiring it up as so:

```ts
class Service {
  constructor(
    private readonly resolve: (id: string) => Decider<Event, State>
  ) {}

  increment(id: string) {
    const decider = this.resolve(id)
    const command: Command = { type: 'Increment' }
    return decider.transact(state => decide(command, state))
  }

  decrement(id: string) {
    const decider = this.resolve(id)
    const command: Command = { type: 'Decrement' }
    return decider.transact(state => decide(command, state))
  }

  // wire up to memory store category
  static create(store: VolatileStore<string>) {
    const fold = (state: State, events: Event[]) => events.reduce(evolve, state)
    const category = MemoryStoreCategory.create(store, 'Counter', codec, fold, initial)
    const resolve = (id: string) => Decider.forStream(category, id, null)
    return new Service(resolve)
  }
}
```

Through our experience developing event sourced applications we've arrived at
two modifications to the pattern as described by Jeremie. First, while we think
the `evolve` function is great we recognise that it can lead to inefficiencies.
Imagine the case of a shopping cart, most likely you'll represent the items in
it as a list.

```ts
function evolve(state: string[], event: Event) {
  switch (event.type) {
    case 'ItemAdded': 
      return [...state, event.data.itemId]
    case 'ItemRemoved': 
      return state.filter(x => x !== event.data.itemId)
  }
}
```

This would incur a lot of allocations and cpu usage, each run of the evolve
function would allocate a totally new Array! By using `fold` instead we can
benefit from local mutability.

```ts
function fold(state: State, events: Event[]) {
  const newState = new Set(state)
  for (const event of events) {
    switch (event.type) {
      case 'ItemAdded': state.add(event.data.itemId); break
      case 'ItemRemoved': state.delete(event.data.itemId); break
    }
  }
  return newState
}
```

The fold function embraces mutability, but this mutability exists solely within
the function itself, from the outside it is immutable. In most cases the
performance requirements won't require mutability like this, but when it does
matter it tends to really matter. Because of this you are asked to supply
equinox with a `fold` function instead of an `evolve` function.

The second divergence from the pattern has to do with Commands. We've come to
reject the Command pattern entirely. Instead of exposing a union type of all
possible commands we expose functions. This is due to the fact that a single
Command DU implies a single return type for all commands. There are however
cases where you want to return a result in addition to writing down a fact. A
single Command DU becomes a burden at that point. Imagine the case of checking
out of a hotel stay.

```ts
type CheckoutResult = 
  | { type: 'Ok' } 
  | { type: 'BalanceOutstanding', amount: number }

const checkout = (at: Date) => (state: State): [CheckoutResult, Event[]] => {
  switch (state.type) {
    case 'Closed': return [{ type: 'Ok' }, []]
    case 'Active': {
      const residual = state.balance
      if (residual === 0) {
        return [{ type: 'Ok' }, [{ type: 'CheckedOut', data: { at } }]]
      } else {
        return [{ type: 'BalanceOutstanding', amount: state.balance }, []]
      }
    }
  }
}
```

While processing a checkout demands a result, the same might not be true for
checking in, recording a payment, or any number of other things the decider
might be responsible for.

With these modifications in mind, a more proper counter example would look like
this:


```ts
type Event = { type: 'Incremented' } | { type: 'Decremented' }
type Command = { type: 'Increment' } | { type: 'Decrement' }
type State = { count: number }
const initial: State = 0
// avoids allocating a new object for each event 
const fold = (state: State, events: Event[]) => {
  let count = state.count
  switch (event.type) {
    case 'Incremented': ++count; break
    case 'Decremented': --count; break
  }
  return { count }
}

const increment = (state: State) => {
  if (state.count < 10) return [{ type: 'Incremented'  }]
  return []
}

const decrement = (state: State) => {
  if (state.count > 0) return [{ type: 'Decremented'  }]
  return []
}

class Service {
  constructor(
    private readonly resolve: (id: string) => Decider<Event, State>
  ) {}

  increment(id: string) {
    const decider = this.resolve(id)
    return decider.transact(increment)
  }

  decrement(id: string) {
    const decider = this.resolve(id)
    return decider.transact(decrement)
  }

  // wire up to memory store category
  static create(store: VolatileStore<string>) {
    const category = MemoryStoreCategory.create(store, 'Counter', codec, fold, initial)
    const resolve = (id: string) => Decider.forStream(category, id, null)
    return new Service(resolve)
  }
}
```

It should be noted that these modifications do not sacrifice the testability of
the decider.

```ts
const given = (events: Event[], decide: (state: State) => Event[]) =>
  decide(fold(initial, events))

test('Increment', () => 
  expect(given([], increment)).toEqual([{ type: 'Incremented' }]))

test('Cannot increment over 10', () => 
  expect(given(Array(10).fill({type: 'Incremented'}), increment)).toEqual([]))
```

