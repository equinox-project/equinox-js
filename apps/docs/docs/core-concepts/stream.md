---
sidebar_position: 1
---

# Stream

Streams are the fundamental unit of organization of event sourced systems, providing a sequence of events that represent
the state changes of an entity over time. Each stream represents a single entity, aggregate, process, or workflow.
New events are always appended to the end of the stream. In an event sourced system the stream is the source of truth.

Each event in a stream represents a business fact or a discrete state change, such as a user having registered or a
withdrawal from a bank account. Events are considered immutable and as such should not be modified once they have been
written to the stream. This ensures that the history of the entity remains accurate.

