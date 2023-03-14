---
sidebar_position: 1
---

# Category

In event sourcing, a category is a grouping of related streams that share events of the same schema with consistent
semantic meaning. Categories are analogous to classes in object-oriented systems, and play an important role
in organizing data in any event sourced system.

Equinox builds on this conceptual foundation. In addition to sharing event schema and meaning, a category in Equinox
shares a consistent way to [`fold`](https://en.wikipedia.org/wiki/Fold_%28higher-order_function%29) events into state,
and therefore a consistent `state`. The Category abstracts the details of how events are loaded from and written to a
concrete store. By buying into the equinox programming model you make it easier to swap out different storage
implementations as the needs of your system evolve over time.
