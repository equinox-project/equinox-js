---
sidebar_position: 3
---

# Decider

In event sourcing a Decider is responsible for mapping an intent and previous history to new events. This is slightly
tangential to Equinox's concept of a Decider. In Equinox a Decider is an abstraction over a Stream that allows 
transacting and querying that stream. The abstraction chain can be thought of as:

1. A Category shares event schema, meaning, and state 
2. A Stream is a specific instance within a Category
3. A Decider provides a convenience interface on top of a Stream that manages the OCC retry loop when transacting.

The primary way to get your hands on a decider instance is `Decider.resolve`.

```ts
const decider = Decider.resolve(storeCategory, 'CategoryName', streamId, context)
```

When resolving a decider you need a store category, a category name, a stream ID, and the context in which it's being
resolved (e.g. tenantId). Under the hood this will resolve an `IStream` instance from the store category and pass it
to a `new Decider(stream)`.

Note that this will not load any events, that will only happen in response to a `transact` or a `query`.

```ts
decider.transact((state): Event[] => [{ type: "SomethingHappened" }])
const property = await decider.query(state => state.property)
```
