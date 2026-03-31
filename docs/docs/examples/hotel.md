# Hotel

A hotel group checkout example can be found on the project's
[github](https://github.com/equinox-project/equinox-js/tree/main/apps/hotel).
Its main goal is to show how to implement a process manager in EquinoxJS by
composing deciders, services and reactions.

This example matters because it demonstrates that EquinoxJS can handle the kind
of cross-aggregate workflow many libraries solve by introducing a dedicated
workflow abstraction. Here, the same result is achieved by composing the core
primitives directly.

The example is intentionally interesting because it crosses aggregate
boundaries without introducing a separate workflow framework. The
`GroupCheckout` aggregate maintains process state, `Flow.nextAction` derives the
next step from that state, and the reactor host wakes the process up from the
store's change feed.

The README explains the operational considerations in detail, including how the
reactor deals with feed lag and how the process manager composes with domain
services.

## Components

- [A guest stay decider](https://github.com/equinox-project/equinox-js/blob/main/apps/hotel/src/domain/GuestStay.ts)
- [A group checkout decider](https://github.com/equinox-project/equinox-js/blob/main/apps/hotel/src/domain/GroupCheckout.ts)
- [A group checkout process manager](https://github.com/equinox-project/equinox-js/blob/main/apps/hotel/src/reactor/GroupCheckoutProcessor.ts)

## What It Demonstrates

- A process manager built from ordinary EquinoxJS primitives
- How folded aggregate state can be projected into a `Flow` action
- How a reaction host drives cross-stream work from the store's change feed
- How to keep domain logic in services and deciders rather than transport or workflow infrastructure
- That the library's "not a framework" stance still covers real workflow use cases

## Tech used

- EquinoxJS
- [variant](https://paarthenon.github.io/variant/) for creating DUs
- [immer](https://immerjs.github.io/immer/) for updating state using mutable code
- AWS CDK to deploy the DynamoStore stack
