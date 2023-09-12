---
sidebar_position: 1
---

# DynamoStore Architecture

When building an event store on top of a serverless NoSQL database it is
imperative to apply mechanical sympathy. We've seen implementations of DynamoDB
event stores using a single event-per-item strategy. This would seem the obvious
choice so let's start by explaining why it's not the greatest idea.

## DynamoDB cost model

Zach Charles has a great [article conveying the structure of DynamoDB's pricing
model](https://zaccharles.medium.com/calculating-a-dynamodb-items-size-and-consumed-capacity-d1728942eb7c)
-- the charges closely mirror the actual work involved, and any good design
will balance those forces well.

The gist of it is that you pay per 4KB for reads, and 1KB for writes, and
transactional writes will cost you double. As such DynamoStore is designed to
utilise `GetItem` and `PutItem` APIs where possible and only resorts to a table
scan and transactional write when absolutely necessary.

With these constraints enumerated it should be clear why an event-per-item
schema is not the greatest idea

1. Reading a stream always necessitates a `Query`
2. Writing will always be transactional so you'll pay double

## The architecture

At heart DynamoDB is a document store and an event sourced system is composed
of multiple streams. It therefore stands to reason that we should model the
storage such that the events of the stream are colocated in a document. This
works great until we run into the 400KB max item size. To solve for this we
will move the current events to another document once the document size reaches
a configurable threshold (in events or bytes).

The majority of streams in a well-designed system are naturally limited to a
low number of events (and aggregate size) so calving is a rare occurrence. For
streams where it's unavoidable we provide functionality to store a snapshot
within the main stream document ensuring that the state of the stream can be
reconstructed in a single round-trip.

To summarise:

- A stream is represented as one or more documents in the store (a Tip document
  and 0 or more calved batches of events)
- The Tip document can contain snapshots (we call these unfolds)
- Since attribute keys count towards item-size we use single letter key names

## Table schema

| Key         | Type                                | Description                                                    |
| ----------- | ----------------------------------- | -------------------------------------------------------------- |
| `p`artition | String                              | The stream name (hash key)                                     |
| `i`ndex     | Number                              | Int32.MAX for `Tip` 0-N for calved batches (range key)         |
| `b`ytes     | ?Number                             | Only exists in the Tip, number of bytes in predecessor batches |
| `etag`      | ?String                             | Etag of latest update (used for OCC)                           |
| `e`vents    | List(Map([Event](#event-schema)))   | [Events](#event-schema)                                        |
| `c`ases     | List(String)                        | Event types                                                    |
| `u`nfolds   | List(Map([Unfold](#unfold-schema))) | [Unfolds](#unfold-schema)                                      |
| `a`ppends   | Number                              | The number of events appended in the latest update             |
| `n`extIndex | Number                              | the index that the next page starts at.                        |

<h2 id="event-schema">Event schema</h2>

| Key             | Type    | Description                                                              |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `t`imestamp     | String  | ISO8601 timestamp representing the time the event was encoded in the app |
| `D`ata encoding | ?Number | the encoding used for the `d`ata attribute                               |
| `d`ata          | ?Binary | The event payload                                                        |
| `M`eta encoding | ?Number | the encoding used for the `m`eta attribute                               |
| `m`eta          | ?Binary | The event metadata                                                       |
| `x`actionId     | ?String | The correlation id of the event                                          |
| wh`y`           | ?String | The causation id (wh`y` did this event occur)                            |

<h2 id="unfold-schema">Unfold schema</h2>

| Key             | Type    | Description                                                      |
| --------------- | ------- | ---------------------------------------------------------------- |
| `i`ndex         | Number  | The version of the state the unfold was generated from           |
| `c`ase          | String  | The event type of the unfold                                     |
| `t`imestamp     | String  | ISO8601 timestamp representing the time the unfold was generated |
| `D`ata encoding | ?Number | the encoding used for the `d`ata attribute                       |
| `d`ata          | ?Binary | The unfold content                                               |
| `M`eta encoding | ?Number | the encoding used for the `m`eta attribute                       |
| `m`eta          | ?Binary | The unfold metadata                                              |

# Reactions

Reacting to events is quite frankly _the point_ of an event-sourced
architecture. DynamoDB offers DynamoDB Streams, a Change Data Capture (CDC) for
your table. The stream is comprised of _stream records_ containing information
about a data modification to a single item in a DynamoDB table. This feed offers
three guarantees:

1. Each stream record appears exactly once in the stream.
2. For each item that is modified in a DynamoDB table, the stream records appear
   in the same sequence as the actual modifications to the item.
3. The stream contains the last 24 hours of stream records.

When reacting to events we need a feed that:

1. all events for a stream must be delivered in order with no gaps (at least
   once delivery can always happen, but a feed that supplies you event 3 of a
   stream before it has presented you with event 2 is worse than useless)
2. there must be a 100% guarantee of all events getting delivered. The
   alternative is programming by coincidence, littering it with nonsensical
   defensive "just in case" code, and spending hours checking logs to see if by
   any chance some event just might have been missed "for any reason".

Unfortunately, the DynamoDB stream does not achieve these requirements. Firstly,
the stream is windowed over the last 24hrs. For event-sourced reactions we need
to be able to stand up a new read-model as if it had always been there. The last
24 hours is simply not good enough, we need all events. Secondly, the ordering
guarantee is for an `Item` (hash and range pair) meaning you can receive updates
within a stream out-of-order.

To work around this we consume the stream to write an index to another DynamoDB
table. The index is continuously kept up to date by a Lambda function. Each
batch (1-10,000 DDB Stream Records) fed to the Lambda is represented as an
`Ingested` event in a sequence of `$AppendsEpoch-<partitionId>-<epoch>` streams
in near real-time after they are appended. Because there's no retention window,
this structure can be deterministically traversed by current or future readers
in perpetuity. 

To avoid problems with the ordering guarantees of Streams every event MUST first
be written to the Tip document.

The index can be read starting from `$AppendsEpoch-0_0` and traversed up to the
tail of the store, checkpointing along the way. Each epoch can hold at most
1,000,000 items and as such we represent the checkpoint as a single `int64`
where the 20 least significant bits represent the position within the epoch and
the other 44 represent the epoch index.
