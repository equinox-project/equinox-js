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

In EquinoxJS codecs as a first class citizen. A naive implementation might look
like this: 

```ts
const codec: Codec<Event, Record<string, any>> = {
  tryDecode(ev): Event | undefined {
    switch (ev.type) {
      case "CheckedIn":
        return { type: ev.type, data: { at: new Date(ev.data.at) } }
      case "CheckedOut":
        return { type: ev.type, data: { at: new Date(ev.data.at) } }
      case "Charged":
        return { type: ev.type, data: { chargeId: ev.data.chargeId, amount: ev.data.amount, at: new Date(ev.data.at) } }
      case "Paid":
        return { type: ev.type, data: { paymentId: ev.data.paymentId, amount: ev.data.amount, at: new Date(ev.data.at) } }
    }
  },
  encode(ev) {
    return ev
  },
}
```

You might decide that this is too naive and that a library like `zod` is called
for instead. We happen to expose a utility codec for zod. 

```ts
const CheckedInSchema = z.object({ at: z.date() })
const CheckedOutSchema = z.object({ at: z.date() })
const ChargedSchema = z.object({ chargeId: z.string().uuid(), amount: z.number(), at: z.date() })
const PaidSchema = z.object({ paymentId: z.string().uuid(), amount: z.number(), at: z.date() })
type Event =
  | { type: "CheckedIn", data: z.infer<typeof CheckedInSchema> }
  | { type: "CheckedOut", data: z.infer<typeof CheckedOutSchema> }
  | { type: "Charged", data: z.infer<typeof ChargedSchema> }
  | { type: "Paid", data: z.infer<typeof PaidSchema> }

const codec = Codec.zod<Event>({
  CheckedIn: CheckedInSchema.parse,
  CheckedOut: CheckedOutSchema.parse,
  Charged: ChargedSchema.parse,
  Paid: PaidSchema.parse,
})
```

Codecs are also where we control the metadata we add onto events. It is common
practice to record metadata like which user performed the action that led to the
event, as well as correlation and causation identifiers. The zod codec accepts a
second argument which transforms the context into metadata.

```ts
type Context = { correlationId: string, causationId: string, userId: string }

const contextToMeta = (ctx: Context) => ({
  // matches ESDB conventions
  $correlationId: ctx.correlationId,
  $causationId: ctx.causationId,
  userId: ctx.userId
})

const codec = Codec.zod<Event, Context>({
  CheckedIn: CheckedInSchema.parse,
  CheckedOut: CheckedOutSchema.parse,
  Charged: ChargedSchema.parse,
  Paid: PaidSchema.parse,
}, contextToMeta)
```

This `Context` is then supplied at decider resolution time

```ts
Decider.forStream(category, streamId, context)
```
