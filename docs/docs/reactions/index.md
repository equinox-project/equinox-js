---
sidebar_position: 3
---

# Reactions

Reactions, in the context of EquinoxJS, are a term that represents responding
to changes to event streams. A Decider makes a decision, a Reactor reacts to 
that decision. You may be familiar with terms like "Projection" and "Process
Manager." These are both valuable concepts, but exist at a higher level than 
a Reaction, that is all projections are reactions, but not all reactions are 
projections.

## Example

Imagine you have a group chat with your friends. After posting a message to the
group you might expect everyone else in the group to be notified. This is a 
fantastic use of a reaction. We'll start by creating a service for sending the 
notifications in a consistent manner.

```ts
// Decider code omitted
export class MessageNotifier {
  constructor(
    private readonly pushNotifier: IPushNotifications,
    private readonly resolve: (messageId: MessageId) => Decider<Event, State>
  ) {
  }

  async sendNotifications(messageId: MessageId, message: Message) {
    const decider = this.resolve(messageId)
    return decider.transactAsync(async state => {
      if (state.hasNotified) return [] // already notified
      try {
        await this.pushNotifier.sendNotifications({
          recipients: message.recipients,
          title: `New message from ${message.sender_name}`
        })
        return [{ type: "NotificationsSent" }]
      } catch (err) {
        // this is not a critical feature, so we're okay with skipping retries and just write down the fact
        // that we couldn't send the notifications for whatever reason
        return [{ type: "NotificationsFailed", data: { error: err } }]
      }
    })
  }
}
```

Note the use of `decider.transactAsync` here. In most cases we want to use 
`transact` in its simplest form but in this case doing that would be very 
inefficent. Instead we let the notifier decide for itself whether the 
notification should be sent based on its own current state. This means we'll 
only attempt to send notifications when we haven't already tried before.

> IMPORTANT: there is still a chance a notification is sent twice. If the 
> power goes out between sending the notifications and recording the fact that 
> we did, a double notification can happen

Now that we have a notifier, we need something to actuate it when a message is 
sent.

```ts
async function react(streamName: string, events: ITimelineEvent[]) {
  const [category, streamId] = StreamName.parseCategoryAndId(streamName)
  if (category !== Message.CATEGORY) return
  const messageId = MessageId.parse(streamId)
  // We know that the MessageSent event is always the first event in the stream 
  // and as such we do not need to check any other event
  const ev = Message.codec.tryDecode(events[0]) 
  if (ev.type !== 'MessageSent') return
  await notifier.sendNotifications(messageId, ev.data)
}
```

This `react` function is responsible for a couple of things. It receives a 
stream name and a list of events from that stream. It then figures out which 
events we're interested in and then performs actions on those events.

The last step is to wire the reaction up to a concrete store

```ts
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import pg from "pg"

const checkpoints = new PgCheckpoints(new pg.Pool({ connectionString: "..." }), "public")
await checkpoints.ensureTable() // creates the checkpoints table if it doesn't exist

const pool = new pg.Pool({ connectionString: "..." })

const source = MessageDbSource.create({
  // the database pool to use
  pool, 
  // under the hood the source polls for baches of events, this controls the batch size
  batchSize: 500,
  // list of categories to subscribe to.
  categories: [Message.CATEGORY], 
  // Consumer group name (used for checkpointing and tracing)
  groupName: "MessageNotifications", 
  // the checkpointer maintains checkpoints on per category per group basis
  checkpoints, 
  // Your handler will receive a list of events for a given stream
  handler: react,
  // Once we've processed all events in the store, how long should we wait before requesting a new batch?
  // In this case we want close to real time so will poll after 100ms
  tailSleepIntervalMs: 100, 
  // How many streams are we OK to process concurrently?
  maxConcurrentStreams: 10, 
  // How many batches can be processod concurrently, checkpointing will always happen in-order
  maxConcurrentStreams: 10, 
})

const ctrl = new AbortController()

process.on('SIGINT', ()=> ctrl.abort())
process.on('SIGTERM', ()=> ctrl.abort())

await source.start(ctrl.signal)
```

Now we've wired up a reaction!

