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
type State = number
let initial: State = 0
let evolve = (state: State, event: Event): State => {
  switch (event.type) {
    case 'Incremented': return state + 1
    case 'Decremented': return state - 1
  }
}
let decide = (command: Command, state: State): Event[] => {
  switch (command.type) {
    case 'Increment': 
      if (state < 10) return [{ type: 'Incremented'  }]
      return []

    case 'Decrement': 
      if (state > 0) return [{ type: 'Decremented'  }]
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
    const resolve = (id: string) => Decider.resolve(category, id, null)
    return new Service(resolve)
  }
}
```

However, we've arrived at a slight modification to the decider pattern through
our experience developing event sourced applications. The first part of the
decider is its aggregate projection (initial + evolve). We expect users to
supply a `fold` instead of an `evolve` function. The difference there is that
the fold function receives a list of events while an evolve function receives a
single event. 

More importantly, we've come to reject the Command pattern. Instead of exposing
a union type of all possible commands we expose functions. This is due to the
fact that a single Command DU implies a single return type for all commands.
We've found that being able to return results from transacting is useful. For
the counter these changes might look like this:

```ts
// ^ everything up to and including evolve.
const fold = (state: State, events: Event[]) => events.reduce(evolve, state)

const increment = (state: State) => {
  if (state < 10) return [{ type: 'Incremented'  }]
  return []
}

const decrement = (state: State) => {
  if (state > 0) return [{ type: 'Decremented'  }]
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
    const resolve = (id: string) => Decider.resolve(category, id, null)
    return new Service(resolve)
  }
}
```

It should be noted that these modifications do not sacrifice the testability of
deciders.

```ts
const given (events: Event[], decide: (state: State) => Event[]) =>
  decide(fold(initial, events))

test('Increment', () => 
  expect(given([], increment)).toEqual([{ type: 'Incremented' }])

test('Cannot increment over 10', () => 
  expect(given(Array(10).fill({type: 'Incremented'}), increment)).toEqual([]))
```

