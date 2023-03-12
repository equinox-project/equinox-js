# Decider

The `Decider` is the central abstraction that you interact with in your application code. It abstracts away
the underlying Store [Category](./category), managing the retrieval and storage of events.

The primary way to get your hands on a decider instance is `Decider.resolve`.

```ts
const decider = Decider.resolve(storeCategory, 'CategoryName', streamId, context)
```

Note that this will not load any events, that will only happen in response to a `transact` or a `query`.

```ts
decider.transact((state): Event[] => []); 
const property = await decider.query(state => state.property)
```
