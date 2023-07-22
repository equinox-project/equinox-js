---
sidebar_position: 3
---

# Decider

<!--

The best treatment of the concept of a Decider is Jeremie Chassaing's blog
[post](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider)
on the subject. In EquinoxJS the type `Decider` exposes an API for making
Consistent Decisions against a Store derived from Events on a Stream.  

- Transact* functions - these run a decision function that may result in a
  change to the State, including management of the retry cycle when a
  consistency violation occurs during the syncing of the state with the backing
  store (See Optmimistic Concurrency Control). Some variants can also yield an
  outcome to the caller after the syncing to the store has taken place.

- Query* functions - these run a render function projecting from the State that
  the Decider manages (but can't mutate it or trigger changes). The concept of
  CQRS is a consideration here - using the Decider to read state should not be a
  default approach (but equally should not be considered off limits).

> NOTE the Decider itself in Equinox does not directly touch all three of the
> ingredients - while you pass it a decide function, the initial and fold
> functions, are supplied to the specific store library (e.g. MessageDB), as
> that manages the loading, snapshotting, syncing and caching of the state and
> events.

A decider's role is to make an autonomous decision, not relying on outside
information. 
 

The Decider is a fundamental abstraction in EquinoxJS. We recommend reading
through Jeremie Chassaing's
[article](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider)
on the concept. 
-->

In event sourcing a Decider is responsible for mapping an intent
and previous history to new events. This is slightly tangential to Equinox's
concept of a Decider. In Equinox a Decider is an abstraction over a Stream that
allows transacting and querying that stream. The abstraction chain can be
thought of as:

1. A Category shares event schema, meaning, and state 
2. A Stream is a specific instance within a Category
3. A Decider provides a convenience interface on top of a Stream that manages
   the OCC retry loop when transacting.

The primary way to get your hands on a decider instance is `Decider.resolve`.

```ts
const decider = Decider.resolve(storeCategory, 'CategoryName', streamId, context)
```

When resolving a decider you need a store category, a category name, a stream
ID, and the context in which it's being resolved (e.g. tenantId). Under the
hood this will resolve an `IStream` instance from the store category and pass
it to a `new Decider(stream)`.

Note that this will not load any events, that will only happen in response to a
`transact` or a `query`.

```ts
decider.transact((state): Event[] => [{ type: "SomethingHappened" }])
const property = await decider.query(state => state.property)
```
