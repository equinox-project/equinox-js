---
sidebar_position: 1
---

# Intro

EquinoxJS is a TypeScript event sourcing library built around deciders, folds,
services and reactions. It is a ground-up re-implementation of the Equinox
project from F#.

EquinoxJS is aimed at teams that want a small set of event sourcing primitives
with clear operational boundaries. The core library stays focused on deciders,
services, reactions and stores rather than introducing a framework around them.

If you already know event sourcing, the main promise is straightforward: EquinoxJS
gives you the important pieces needed to build production systems without
wrapping the domain in handler abstractions, workflow runtimes or framework glue.

Out of the box the project covers the main deployment shapes:

- PostgreSQL via [MessageDB](/docs/message-db)
- Serverless deployments via [DynamoStore](/docs/dynamo-store/architecture)

It also includes the pieces needed for common event sourced application
patterns, so the library scales from a single service to more involved systems:

- [Read models and projections](/docs/reactions/projections)
- [Inline projections for MessageDB](/docs/message-db/inline-projections)
- [Process managers and reactions](/docs/reactions)
- [A worked hotel group checkout example](/docs/examples/hotel)

# When not to use EquinoxJS

EquinoxJS is not for every team or every service.

You should probably look elsewhere if:

- you want a framework that prescribes command handlers, transport wiring and application structure end to end
- you are not actually committed to event sourcing and mostly want straightforward CRUD with an audit trail
- you need multi-stream transactional workflows to be hidden behind a single write API
- your team does not want to reason explicitly about ordering, concurrency, idempotency and replay

EquinoxJS works best when those tradeoffs are acceptable and you want the core
event sourcing mechanics to stay visible.
