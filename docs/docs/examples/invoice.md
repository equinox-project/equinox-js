# Invoice

A simple invoice example project can be found on the project's
[github](https://github.com/equinox-project/equinox-js/tree/main/apps/example).
It shows off a small EquinoxJS application that allows registering payers and
raising invoices against them.

This is the "ordinary application" example. It shows that you do not need a
workflow or integration-heavy scenario to get value from EquinoxJS; the same
primitives work well for a straightforward service with a read model and a
reaction.

This example is useful as a counterweight to the hotel example. Where the hotel
app shows a process manager composed from deciders and reactions, the invoice
app shows the simpler end of the spectrum: a conventional service with a read
model and a reaction.

## Components

- [A simplified invoice decider](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/invoice.ts)
- [A payer profile decider](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/payer.ts)
- [A reaction to e-mail invoices](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/invoice-auto-emailer.ts#L109-L118)
- [A read model](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/read-models/PayerReadModel.ts)
- [Correlation and causation tracking](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/context/context.ts)

## What It Demonstrates

- A straightforward service-oriented EquinoxJS application
- A category-driven reaction that performs side effects
- A PostgreSQL read model alongside the write model
- Correlation and causation metadata flowing through the system
- The smaller end of the same model that also scales to the hotel workflow example

## Tech used

- EquinoxJS
- [zod](https://zod.dev/) to create upcasters and validators
- [ramda](https://ramdajs.com/) for functional utilities
- [express](https://expressjs.com/) for serving HTTP requests
