---
sidebar_position: 4
---

# Codec

It is common in TypeScript applications to use `JSON.stringify` and `JSON.parse`
indiscriminately. In the context of event sourced applications this practice has
a couple of problems. Firstly, these APIs are untyped, there's no guarantee that
what you get from the store is what you expected. Secondly, it is common to
evolve event schemas through upcasting. `JSON.parse` doesn't offer any way to
define the schema you want out or provide default values for missing properties.
These deficiencies can lead to unexpected type errors and behaviours.

In EquinoxJS codecs as a first class citizen. A codec implementation might look
like this:

```ts
import { ICodec } from "@equinox-js/core"

const codec: ICodec<Event, string> = {
  decode(ev): Event | undefined {
    const data = JSON.parse(ev.data || "{}")
    switch (ev.type) {
      case "CheckedIn":
        return { type: ev.type, data: { at: new Date(data.at) } }
      case "CheckedOut":
        return { type: ev.type, data: { at: new Date(data.at) } }
      case "Charged":
        return {
          type: ev.type,
          data: { chargeId: data.chargeId, amount: data.amount, at: new Date(data.at) },
        }
      case "Paid":
        return {
          type: ev.type,
          data: { paymentId: data.paymentId, amount: data.amount, at: new Date(data.at) },
        }
    }
  },
  encode(ev) {
    const data = "data" in ev ? JSON.stringify(ev.data) : undefined
    return { type: ev.type, data }
  },
}
```

While a perfectly valid and safe way to develop applications it can be tedious
to write these transformations and as such many will skip it in favour of using
the default `Codec.json`. This will work great as long as you limit yourself to
event bodies that have the same representation in JavaScript as they do in
JSON. That is, you cannot use complex types such as `Date` or `BigInt` in your
event bodies.

In order to make it easier for you to use such types in your domain we do offer
utilities for bidirectional transformations on events.

```ts
import { Codec } from "@equinox-js/core"
import * as z from "zod"

const DateTime = z.codec(z.iso.datetime(), z.date(), {
  encode: (date) => date.toISOString(),
  decode: (iso) => new Date(iso),
})
const CheckedInSchema = z.object({ at: DateTime })
const CheckedOutSchema = z.object({ at: DateTime })
const ChargedSchema = z.object({ chargeId: z.string().uuid(), amount: z.number(), at: DateTime })
const PaidSchema = z.object({ paymentId: z.string().uuid(), amount: z.number(), at: DateTime })
type Event =
  | { type: "CheckedIn"; data: z.infer<typeof CheckedInSchema> }
  | { type: "CheckedOut"; data: z.infer<typeof CheckedOutSchema> }
  | { type: "Charged"; data: z.infer<typeof ChargedSchema> }
  | { type: "Paid"; data: z.infer<typeof PaidSchema> }

const codec = Codec.body<Event>(Codec.json(), {
  CheckedIn: CheckedInSchema,
  CheckedOut: CheckedOutSchema,
  Charged: ChargedSchema,
  Paid: PaidSchema,
})
```

`Codec.body` accepts a mapping of event types to codecs. zod v4 happens to
implement the codec interface so can be used directly. If an event type arrives
that is not included in the mapping it will be silently dropped. This is
because it's a common evolution in event sourced systems for events to become
dead weight, or unnecessary. By providing a body mapping you've essentially
defined exactly the events you care about and the codec will respect that by
returning `undefined` for events outside the mapping, and throwing when your
decode or encode fails.

# Metadata

It is common to record metadata about events such as correlation and causation
ids, user id, and more. See [Savvas's
list](https://github.com/ylorph/The-Inevitable-Event-Centric-Book/issues/42) for
inspiration. We have a few ways to achieve this in EquinoxJS. Firstly, we could
record this information on our domain event type.

```ts
type Meta = { userId: string }
type Event = { type: "SomethingHappened"; data: { what: string }; meta: Meta }
```

The second and preferred option is to use the `Context` variable. You can
map the event and context to a metadata type.

```ts
type Context = { tenantId: string; correlationId: string; causationId: string; userId: string }
type Event = { type: "SomethingHappened"; data: { what: string } }

const mapMeta = (ev: Event, ctx: Context) => ({
  meta: {
    // matches ESDB conventions
    $correlationId: ctx.correlationId,
    $causationId: ctx.causationId,
    userId: ctx.userId,
  },
})

const codec = Codec.json<Event, Context>(mapMeta)
```

The `Context` is supplied at decider resolution time

```ts
Decider.forStream(category, streamId, context)
```
