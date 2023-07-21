# Reactions

Reactions, in the context of EquinoxJS, are a term that represents responding to changes to event streams. A Decider
makes a decision, a Reactor reacts to that decision. You may be familiar with terms like "Projection" and "Process
Manager." These are both valuable concepts, but exist at a higher level than a Reaction, that is all projections are
reactions, but not all reactions are projections.

## Example

Imagine you have a group chat with your friends. After posting a message to the group you might expect everyone else
in the group to be notified. This is a fantastic use of a reaction. We'll start by creating a service for sending the
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

Note the use of `decider.transactAsync` here. In most cases we want to use `transact` in its simplest form but in this
case doing that would be very inefficent. Instead we let the notifier decide for itself whether the notification should
be sent based on its own current state. This means we'll only attempt to send notifications when we haven't already
tried before.

> NOTE: there is still a scenario where a notification is sent twice. If the power goes out between sending the
> notifications and recording the fact that we did

Now that we have a notifier, we need something to actuate it when a message is sent.

```ts
async function react(streamName: string, events: ITimelineEvent<string>[]) {
  const [category, streamId] = StreamName.parseCategoryAndId(streamName)
  if (category !== Message.CATEGORY) return
  const messageId = MessageId.parse(streamId)
  // We know that the MessageSent event is always the first event in the stream and as such we do not need to check any other event
  const ev = Message.codec.tryDecode(events[0]) 
  if (ev.type !== 'MessageSent') return
  await notifier.sendNotifications(messageId, ev.data)
}
```

This `react` function is responsible for a couple of things. It receives a stream name and a list of events from that stream
It then figures out which events we're interested in and then performs actions on those events.

The last step is to wire the reaction up to a concrete store

```ts
import { MessageDbSource, PgCheckpoints } from "@equinox-js/message-db-consumer"
import pg from "pg"

const checkpointer = new PgCheckpoints(new pg.Pool({ connectionString: "..." }), "public")
await checkpointer.ensureTable() // creates the checkpoints table if it doesn't exist

const pool = new pg.Pool({ connectionString: "..." })

const source = MessageDbSource.create({
  pool, // the database pool to use
  batchSize: 500, // under the hood the source polls for baches of events, this controls the batch size
  categories: [Message.CATEGORY], // list of categories to subscribe to.
  groupName: "MessageNotifications", // Consumer group name (used for checkpointing and tracing)
  checkpointer, // the checkpointer maintains checkpoints on per category per group basis
  // Your handler will receive a list of events for a given stream
  handler: react,
  tailSleepIntervalMs: 100, // If we reach the end of the event store, how long should we wait before requesting a new batch?
  maxConcurrentStreams: 10, // How many streams are we OK to process concurrently?
})

const ctrl = new AbortController()

process.on('SIGINT', ()=> ctrl.abort())
process.on('SIGTERM', ()=> ctrl.abort())

await source.start(ctrl.signal)
```

Now we've wired up a reaction!

# Notes

- The only ordering guarantee is within a stream. You might get events across streams in any order
- The source will "fail fast." Make sure you restart it on failure