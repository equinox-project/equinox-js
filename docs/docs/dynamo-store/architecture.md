---
sidebar_position: 1
---

# DynamoStore Architecture

When it comes to building an event store on top of a serverless NoSQL database
it is imperative to apply mechanical sympathy. We've seen implementations of
DynamoDB event stores using a single-event-per-row strategy. This would seem the
obvious choice so let's start by explaining why it's not the greatest idea.

## DynamoDB cost model

A great article to understand DynamoDB's pricing model was written by Zach
Charles
[here](https://zaccharles.medium.com/calculating-a-dynamodb-items-size-and-consumed-capacity-d1728942eb7c).

The gist of it is that you pay per 4KB for reads, and 1KB for writes, and
transactional writes will cost you double. As such DynamoStore is designed to
utilise GetItem and PutItem APIs where possible and only does a table scan and
transactional write when absolutely necessary.

With these constraints enumerated it should be clear why an event-per-row
schema is not the greatest idea

1. Reading a stream necessitates a scan in which you pay 0.5RUs at minimum for
   each event in the stream
2. Writing will always be transactional so you'll pay double

## The architecture

At heart DynamoDB is a document store and an event sourced system is composed
of multiple streams. It therefore stands to reason that we should model the
storage such that the stream is the document. This works great until we run into
the 400KB max item size. To solve for this we will move the current events to
another document once the document size reaches a configurable threshold (in
events or bytes). Streams are generally short-lived so calving should be a rare
occurrence. For streams where it's unavoidable we provide functionality to store
a snapshot alongside the main stream document ensuring that the state of the
stream can be reconstructed in at most 1 round trip.

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
| `n`umber    | Number                              | The version of the stream                                      |

<h2 id="event-schema">Event schema</h2>

| Key             | Type    | Description                                                  |
| --------------- | ------- | ------------------------------------------------------------ |
| `t`imestamp     | String  | ISO8601 DateTime representing the time the event was written |
| `D`ata encoding | ?Number | the encoding used for the `d`ata attribute                   |
| `d`ata          | ?Binary | The event payload                                            |
| `M`eta encoding | ?Number | the encoding used for the `m`eta attribute                   |
| `m`eta          | ?Binary | The event metadata                                           |
| `x`actionId     | ?String | The correlation id of the event                              |
| wh`y`           | ?String | The causation id (wh`y` did this event occur)                |

<h2 id="unfold-schema">Unfold schema</h2>

| Key             | Type    | Description                                                  |
| --------------- | ------- | ------------------------------------------------------------ |
| `i`ndex         | Number  | The index at which the unfold was generated                  |
| `c`ase          | String  | The event type of the unfold                                 |
| `t`imestamp     | String  | ISO8601 DateTime representing the time the event was written |
| `D`ata encoding | ?Number | the encoding used for the `d`ata attribute                   |
| `d`ata          | ?Binary | The event payload                                            |
| `M`eta encoding | ?Number | the encoding used for the `m`eta attribute                   |
| `m`eta          | ?Binary | The event metadata                                           |

# Reactions

Reactions are an often necessary part of event-sourced architectures. DynamoDB
offers DynamoDB Streams, a Change Data Capture (CDC) for your table. This CDC
feed offers two guarantees

- Each stream record appears exactly once in the stream
- For each item that is modified in a DynamoDB table, the stream records appear
  in the same sequence as the actual modifications to the item.
- The stream contains the last 24 hours of updates

You'll notice that the second guarantee notably does not guarantee ordering
across items within the same hash key, only for updates to a singular (hash,
range) pair. For this reason every event written to DynamoStore will be first
written to the Tip document.

The third guarantee means DynamoDB streams cannot be used for general purpose
crawling of all events in the store. One of the main selling points of
event-sourced architectures is that you are able to create a new read-model as
if it had always been there by processing all events in the store. To enable
this we construct an index. This index lives in a secondary table and is kept up
to date by a lambda function that's wired up against the DynamoDB stream. It
represents each batch (1-10,000 DDB Streams Records fed to the Lambda) as an
Ingested event in a a sequence of `$AppendsEpoch-<partitionId>_<epoch>` streams
in near real-time after they are Appended.

The index can be read starting from `$AppendsEpoch-0_0` and traversed up to the
tail of the store, checkpointing along the way. Each epoch can hold at most
1,000,000 items and as such we represent the checkpoint as a single `int64`
where the 20 least significant bits represent the position within the epoch and
the other 44 represent the epoch index.
