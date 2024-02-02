---
sidebar_position: 2
---

# Category

In event sourcing, a category is a grouping of related streams that share events of the same schema with consistent
semantic meaning. Categories are analogous to classes in object-oriented systems, and play an important role
in organizing data in any event sourced system.

Equinox builds on this conceptual foundation. In addition to sharing event schema and meaning, a category in Equinox
shares a consistent way to [`fold`](https://en.wikipedia.org/wiki/Fold_%28higher-order_function%29) events into state,
and therefore a consistent `state`. The Category abstracts the details of how events are loaded from and written to a
concrete store. The Equinox programming model de-emphasises infrastructural plumbing in your application code, helping
you write your domain code in a storage agnostic way.

# Folds and State

It's been said that, in event sourcing, current state is a left fold of previous history, but what does this mean?
We've found the most straight forward way to explain this concept is by drawing a parallel with redux. In redux
you "dispatch" actions to a store. This action is handled by multiple "reducers" to update the state of the store.

```ts
type Action = { type: "Increment" } | { type: "Decrement" }
type State = { count: number }

export function reducer(state: State = { count: 0 }, action: Action): State {
  switch (action.type) {
    case "Increment":
      return { ...state, count: state.count + 1 }
    case "Decrement":
      return { ...state, count: state.count - 1 }
  }
  return state
}
```

One way you can exercise a `redux` reducer is to use `Array#reduce`

```ts
[{ type: 'Increment' }, { type: 'Increment' }].reduce(reducer, { count: 0 }) // { count: 2 }
```

In functional languages like OCaml, and F# this concept is not called `reduce`. It's called `fold`. We could
implement fold in javascript like so:

```ts
const fold = <Acc, T>(folder: (acc: Acc, value: T) => Acc) => (initial: Acc, items: T[]) => {
  let result = initial
  for (let i = 0; i < items.length; ++i) {
    result = folder(result, items[i])
  }
  return result
}
```

Notice the type of the `folder` function `Acc -> T -> Acc`, this is exactly the same signature as the reducer function
above. Therefore, current state being a left fold of previous history means that we can construct the current state of
an aggregate by "folding" its events, starting from the beginning (left).
