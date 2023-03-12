---
sidebar_position: 2
---

# Stream

Streams are the fundamental unit of organization of event sourced systems, providing a sequence of events that represent
the state changes of an entity over time. Each stream represents a single entity, aggregate, process, or workflow.

In Equinox streams are consistency boundaries, there is no API that allows you to write messages across streams in a 
transactional (ACID) manner. When you want to make a change to the state of your system that is exclusively done through 
appending events to a stream. In general this is done in a few steps:

1. Load all events in the stream taking note of the position value of the last event in the stream
2. Fold these events into a view of the current state
3. Based on the current state, make a decision about which events to append in response to the user's intent.
4. Write those events to the store IF AND ONLY IF the position noted in step 1 is still the last position.

Using the version of the stream to control whether to write or not is known as optimistic concurrency control because it
does not require taking out a lock on the stream. Equinox abstracts this logic away from you and provides additional 
functionality like automatic retries in case of a conflict, caching of aggregate state, and different access strategies
for loading your streams.
