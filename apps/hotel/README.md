# Group Checkout / Process Manager / Reactor Example

NOTE: this is not intended to be the first example you touch when exploring Equinox

The purpose of this template is to demonstrate the core aspects of implementing
a Reactor:
- a Domain model that implements the basic behavior of the aggregates in the
  model (without directly implementing the reaction logic itself)
- a Reactor host project that owns the reactive element of a process, using
  Propeller to manage the reading and dispatching of events (the Process
  implementation itself uses the Domain layer to effect some of the reactions)
- a [Process Manager](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html)
  implemented using Equinox 
- Unit testing reactions with a MemoryStore (without using Propeller 
  components or wiring up subscriptions)
- Illustrates how to have a single end-to-end scenario that involves a
  requirement for the Reactor application to drive some aspect of the processing
  within an application. As part of that, a single scenario implementation is
  coupled to one of the available sets of infrastructure
- A Concrete store integration testing scenario that uses wiring that maximizes
  the wiring code shared with the actual Reactor Host application. In this
  scenario, steps relying on reaction processing may require retrying parts
  that rely on a reaction having been carried out in response to a notification
  propagated from the store's event feed
- while the design is intended to provide for the implementation of correct
  behavior in the face of concurrent activity on a given `GuestStay` aggregate
  (e.g., when two clerks concurrently try to merge a stay into different
  `GroupCheckout`s), that's intentionally not implemented here in order to
  allow a reader to absorb the high level structure rather than getting lost in
  a sea of details.

## Domain overview

The aggregates and events are based on the scenario as outlined and implemented in
https://github.com/oskardudycz/EventSourcing.NetCore/tree/main/Sample/HotelManagement.
The code (in C#) and video overview explains the scenario in full.

Having said that, here's a brief overview of how the behavior or the system is split:

- `GuestStay` represents the events tracked as part of an individual's stay in
  the hotel. It's anticipated that the bulk of hotel stays are individually
  managed. As such, the typical conclusion to the activities is to have a
  normal `CheckedOut` event mark the point at which payment has been accounted
  for and the stay no longer requires tracking

- `GroupCheckout` records the activity of collectively managing the checkout of
  a set of Stays.

  1. The clerk identifies a set of stays that are to be checked out
     ('StaysSelected')
  2. The reactor visits each in turn, recording the unpaid amount for each Stay
     in a `StaysMerged` event on the GroupCheckout (or, if the Stay has already
     been added to another Group, or directly `CheckedOut`, a `MergeFailed` is
     used to record that fact)
  3. (further stays can be added at any time prior to completion)
  4. A payment can be recorded as `Paid` at any time
  5. The GroupCheckout can be `Confirmed` as complete when the total residual
     amounts across all `StaysMerged` gathered by the Reactor have been `Paid`

## Reactions implemented using the Process Manager pattern

While the original implementation uses the Saga Pattern and a Message Bus to
coordinate the transfer of the balance of the GuestStay balance onto the
`GroupCheckout`, this implementation uses the following key elements instead:

1. Cross-stream work is entirely driven by the processing of events from the
   store's change feed (this means there is no reliance on a Command Bus /
   pub-sub queue to hold the in-process work)
2. While the `GuestStay` does participate in the process as a whole (noting
   the id of the `GroupCheckout` to which it has been merged into), none of
   the processing is in reaction to events on the `GuestStay` events

## High level processing structure

- A `GroupCheckout` stream maintains a [Todo List](https://blog.bittacklr.be/the-to-do-list-pattern.html)
  of stays that the Group has been asked to take over the management of
- That Todo list is the State for the Process Manager (the relevant pieces of
  the overall State get mapped to `Flow.Action` by `Flow.nextAction`)
- Propeller is used to wire from the subscription to the `GroupCheckout` event
  category to the `Reactor.Handler`. Whenever one or more events are pending
  processing for a given stream, the relevant backlog of `events` are passed
  to the `handler`. Propeller guarantees that there will only be a single
  handler invocation in flight at any time for a given stream.
- While the `StaysSelected` event is the primary event that drives the need for
  the reactor to carry out activities, we read the full state in order that we
  don't have to re-visit Stays that we know we have already merged into the
  `GroupCheckout`. Instead, we load the full state of the Checkout and walk
  only the Stays that have not yet had either a success or failure outcome
  recorded for them.

## Reading Your Writes / `OverrideNextIndex`

The process is not necessarily dependent on the Reactor being able to
immediately see the events notified on the change feed.

Examples:
1. if event 0 is `StaysSelected`, that will trigger the handler. If the
   Handler attempts to read `GroupCheckout` state _but that event has not yet
   propagated to the node from which the Handler reads_, the State will be
   `Flow.Action.Ready 0`, and the Handler will immediately yield a
   `SpanResult.OverrideNextIndex 0`

2. if the read _does_ include the `StaysSelected`, then the State will be
   `Flow.Action.MergeStays { stays = (6 stayIds) }`. The
   `GroupCheckoutProcess` (concurrently) visits each of the Stays identified
   by the current pending `stayIds`. If there are 5 successes and 1 failure,
   the result is `StaysMerged { stays = [{stayId = ..., residual = ...], ...]}`
   and `MergesFailed { stays = [ (stayid) ]}`. After writing those two events
   to the stream, the version has moved from `1` to `3`, resulting in
   `SpanResult.OverrideNextIndex 3`.

   This implies two possible outcomes:
   
   1. Propeller notes we are at Version 3 and will
      discard events 1 and 2 on receipt from the change feed, without
      even entering the streams buffer (and no further handler invocations
      take place)
   2. At the point where Propeller sees the `OverrideNextIndex`, events
      and/or 2 have already been read and buffered ready for dispatch. In
      this case, the events are removed from the buffer immediately (and no
      further handler invocations take place)

