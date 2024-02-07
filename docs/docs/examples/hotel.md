# Hotel

A hotel group checkout example can be found on the project's
[github](https://github.com/equinox-project/equinox-js/tree/main/apps/hotel).
Its main goal is to show how one might implement a process manager in equinox.
The readme explains in detail the considerations that went into the example.

## Components

- [A guest stay decider](https://github.com/equinox-project/equinox-js/blob/main/apps/hotel/src/domain/GuestStay.ts)
- [A group checkout decider](https://github.com/equinox-project/equinox-js/blob/main/apps/hotel/src/domain/GuestStay.ts)
- [A group checkout process manager](https://github.com/equinox-project/equinox-js/blob/main/apps/hotel/src/reactor/GroupCheckoutProcessor.ts)

## Tech used

- EquinoxJS
- [variant](https://paarthenon.github.io/variant/) for creating DUs
- [immer](https://immerjs.github.io/immer/) for updating state using mutable code
- AWS CDK to deploy the DynamoStore stack



