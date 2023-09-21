# StreamsSink Architecture

## AsyncQueue

The StreamsSink uses an AsyncQueue that provides a node-friendly way to handle a
queue of items without blocking waits.

It is backed by a basic FIFO Queue, implemented using a linked list. When an
item is added to the AsyncQueue, it first checks if there are any pending
retrieval requests. If there are, it fulfills the oldest request. If not, it
queues the item. The dequeueing operation retrieves an item from the queue. If
the queue is empty, it waits asynchronously until an item is available or until
an abort signal is triggered, which would stop the wait and reject the promise

## Receiving batches

For every event within a batch, the StreamsSink checks if its associated Stream
is already in the processing queue. If it is, the event is combined with it,
ensuring it's processed alongside previously queued events.

The set of streams associated with the batch are stored in a `Set` so we can
know when a batch has finished processing and notify the submitter.

The StreamsSink limits the number of in-flight batches to a configured number.
When a batch is submitted we check the number of in-flight batches and if it has
reached the threshold delays the introduction of the batch's events until a
previous batch completes. 

## Worker loops

A set number of worker loops are started based on the configured concurrency
limit, which then pick up and process streams from the AsyncQueue. Once a stream
is processed some bookkeeping is required.

1. The stream is removed from each batch's `Set` of streams
2. If that brings the batch's `Set` size to 0 we know the batch is fully handled
   and call its associated `onComplete` handler
