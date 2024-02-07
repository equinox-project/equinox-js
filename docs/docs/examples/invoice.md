# Invoice

A simple invoice example project can be found on the project's
[github](https://github.com/equinox-project/equinox-js/tree/main/apps/example).
It shows off a simple equinox application that allows registering payers and
raising invoices against them.

## Components

- [A simplified invoice decider](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/invoice.ts)
- [A payer profile decider](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/payer.ts)
- [A reaction to e-mail invoices](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/domain/invoice-auto-emailer.ts#L109-L118)
- [A read model](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/read-models/PayerReadModel.ts)
- [Correlation and causation tracking](https://github.com/equinox-project/equinox-js/blob/main/apps/example/src/context/context.ts)

## Tech used

- EquinoxJS
- [zod](https://zod.dev/) to create upcasters and validators
- [ramda](https://ramdajs.com/) for functional utilities
- [express](https://expressjs.com/) for serving http requests

