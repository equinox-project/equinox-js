---
sidebar_position: 9
---

# FAQ

## Why would I pick EquinoxJS?

EquinoxJS is for teams that want event sourcing primitives rather than an
application framework.

In practice that means:

- your domain stays centered on deciders, folds and services
- commands are optional rather than forced into the core model
- projections and process managers are composed from the same primitives
- store-specific concerns such as access strategy, caching and projection
  behavior stay visible

If you've already accepted that event sourcing lives or dies on ordering, concurrency
and replay semantics, this style tends to age well.

## Who is it not for?

EquinoxJS is probably not a good fit if your aim is to hide the shape of event
sourcing from you rather than learn and apply it directly.

- If you want an end-to-end framework with built-in command handlers, transports, and workflow abstractions, choose one.
- If your problem is better modeled as CRUD plus history, event sourcing will add complexity without much payoff.
- If you need cross-stream coordination to feel like a single ambient transaction, EquinoxJS will feel too explicit.
- If your team does not want to think about replay, checkpointing, ordering and idempotency yet, or feels those concerns would scare newcomers, the model will feel too explicit.

## What deployment paths are documented?

The primary ones today:

- PostgreSQL via MessageDB
- Serverless deployments via DynamoStore

## Does it support read models?

Yes.

- Reactions cover asynchronous projections and process managers
- `@equinox-js/projection-pg` provides PostgreSQL projection helpers
- MessageDB supports inline projections when that tradeoff makes
  sense

## Is it a framework?

No. That is deliberate.

EquinoxJS gives you the domain and store primitives needed to build a service,
projector or process manager without prescribing transport, hosting or handler
shape. It is also not intended to accrete framework-style features every time a
new use case appears.

## Why name it Equinox?

The original [jet/equinox](https://github.com/jet/equinox) is named after the DC
superhero of the same name. The authors of EquinoxJS were not aware of this. Our
reasons for the Equinox name are:

1. An equinox is a significant _event_ in most cultures
2. It is inherently intertwined with the concept of time
3. It represents synchronisation and balance
