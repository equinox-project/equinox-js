# Category

In event sourcing, a category is a grouping of related streams that share events of the same schema with consistent
semantic meaning. Categories are analogous to classes in object-oriented systems, and play an important role
in organizing data in any event sourced system. However, in Equinox, categories play an outsized role as the primary
means by which you interact with concrete stores when wiring up your services. In Equinox, you interact with a concrete
store through its category implementation.

By making categories the primary means of interacting with concrete stores, Equinox provides a consistent abstraction
layer that simplifies the development and maintenance of event sourced systems. This approach enables developers to
focus less on infrastructural concerns like low-level details of how events are stored and retrieved from storage, and
more on the inherent complexity of their domain. Additionally, by providing a consistent way of interacting with
stores, Equinox makes it easier to swap out different implementations of the data store as the needs of the system
evolve over time.
