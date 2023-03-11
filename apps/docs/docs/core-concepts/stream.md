---
sidebar_position: 1
---

# Stream

Streams are the fundamental unit of organization of event sourced systems, providing a sequence of events that represent
the state changes of an entity over time. Each stream represents a single entity or aggregate, and events are appended
to the stream in the order they occur. In an event sourced system the stream is the source of truth for state.

Streams are often implemented as a sequence of events that are stored in an append-only data store, such as a log or
database. Each event represents a discrete state change, such as a user account being created or an order being placed.
Events are immutable and cannot be modified once they have been written to the stream, ensuring that the history of the
entity remains accurate and tamper-proof.

In addition to providing a complete audit trail of changes to an entity, streams can also be used to support projections
and views of the data. Projections are a way of transforming the stream of events into a different representation of the
data, such as a materialized view or an aggregate of related events. This can be useful for querying the data in
different ways, such as generating reports or performing analytics.

Streams are a powerful abstraction for organizing data in event sourced systems, but they do require careful
consideration when designing the system architecture. It's important to choose an appropriate data store that can
efficiently store and retrieve large numbers of events, and to carefully consider the trade-offs between consistency,
availability, and performance. By carefully designing the stream-based architecture of an event sourced system, it
becomes possible to build highly scalable, performant, and resilient applications that can respond in real-time to
changes in state.

