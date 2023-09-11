# DynamoStore Architecture

## Considerations

- Event per row is silly
- You pay per 4k of data transfer and per request

> DynamoDB Streams helps ensure the following:
>
> - Each stream record appears exactly once in the stream.
> - For each item that is modified in a DynamoDB table, the stream records appear
>   in the same sequence as the actual modifications to the item.

The above notably does _not_ guarantee that you'll receive events in-order for a
particular hash, only for each individual document.

## Table schema

| Key         | Type              | Description                                                    |
| ----------- | ----------------- | -------------------------------------------------------------- |
| `p`artition | String            | The stream name (hash key)                                     |
| `i`ndex     | Number            | Int32.MAX for `Tip` 0-N for calved batches (range key)         |
| `b`ytes     | ?Number           | Only exists in the Tip, number of bytes in predecessor batches |
| `etag`      | ?String           | Etag of latest update (used for OCC)                           |
| `e`vents    | List(Map(Event))  | [Events](#event-schema)                                        |
| `c`ases     | List(String)      | Event types                                                    |
| `u`nfolds   | List(Map(Unfold)) | [Unfolds](#unfold-schema)                                      |
| `a`ppends   | Number            | The number of events appended in the latest update             |
| `n`umber    | Number            | The version of the stream                                      |

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

<h2 id="unfol-schema">Unfold schema</h2>

| Key             | Type    | Description                                                  |
| --------------- | ------- | ------------------------------------------------------------ |
| `i`ndex         | Number  | The index at which the unfold was generated                  |
| `c`ase          | String  | The event type of the unfold                                 |
| `t`imestamp     | String  | ISO8601 DateTime representing the time the event was written |
| `D`ata encoding | ?Number | the encoding used for the `d`ata attribute                   |
| `d`ata          | ?Binary | The event payload                                            |
| `M`eta encoding | ?Number | the encoding used for the `m`eta attribute                   |
| `m`eta          | ?Binary | The event metadata                                           |

## Architecture

In the simple case a stream is represented as a single document. We call this
document the `Tip`. When the number of events grows large in terms of raw
number, or byte size, the current events are moved to a "calved batch." while
new events are written to the Tip document. Because of the DDB streams delivery
guarantees mentioned above every event must first be written to the Tip
document.

## Tailing the feed

As DynamoDB streams have a window of 1 day as well as insufficient ordering
guarantees for general event sourced reaction handling we construct a separate
index. The indexer represents each batch (1-10,000 DDB Streams Records fed to
the Lambda) as an Ingested event in a sequence of
`$AppendsEpoch-<partitionId>_<epoch>` streams in near real time after they are
Appended.

This index can be read starting from `$AppendsEpoch-0_0` and traversed up to the
tail of the store, checkpointing along the way.

The Checkpoint is an int64 where the least significant bits represent the epoch
and the most significant bits represent the index in that epoch (an epoch has a
maximum size of `1,000,000`).

In order to create the index we supply a CDK project that wires up a lambda
function against the DDB Stream of the events table, writing to an index table. 


