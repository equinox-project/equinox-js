---
sidebar_position: 4
---

# Codec

It is common in TypeScript applications to use `JSON.stringify` and `JSON.parse` indiscriminately. In the context of
event sourced applications this practise has a couple of problems. Firstly, these APIs are untyped, there's no guarantee
that what you get from the store is what you expected. Secondly, it is common to evolve event schemas through upcasting.
`JSON.parse` doesn't offer any way to define the schema you want out or provide default values for missing properties.
These deficiencies can lead to unexpected type errors and behaviours.

In EquinoxJS codecs as a first class citizen. A naive implementation might look like this: 

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

You might decide that this is too naive and that a library like `zod` is called for instead

```ts
const CheckedInSchema = z.object({ at: z.date() })
const CheckedOutSchema = z.object({ at: z.date() })
const ChargedSchema = z.object({ chargeId: z.string().uuid(), amount: z.number(), at: z.date() })
const PaidSchema = z.object({ paymentId: z.string().uuid(), amount: z.number(), at: z.date() })

const codec: Codec<Event, Record<string, any>> = {
  tryDecode(ev): Event | undefined {
    try {
      switch (ev.type) {
        case "CheckedIn":
          return { type: ev.type, data: CheckedInSchema.parse(ev.data) }
        case "CheckedOut":
          return { type: ev.type, data: CheckedOutSchema.parse(ev.data) }
        case "Charged":
          return { type: ev.type, data: ChargedSchema.parse(ev.data) }
        case "Paid":
          return { type: ev.type, data: PaidSchema.parse(ev.data) }
      }
    } catch (err) {
      if (err instanceof ZodError) return undefined
      throw err
    }
  },
  encode(ev) {
    return ev
  }
}
```

Codecs are also where we control the metadata we add onto events

```ts
const CheckedInSchema = z.object({ at: z.date() })
const CheckedOutSchema = z.object({ at: z.date() })
const ChargedSchema = z.object({ chargeId: z.string().uuid(), amount: z.number(), at: z.date() })
const PaidSchema = z.object({ paymentId: z.string().uuid(), amount: z.number(), at: z.date() })

type Context = { correlationId: string, causationId: string, tenantId: string, userId: string }

const codec: Codec<Event, Record<string, any>, Context> = {
  tryDecode(ev): Event | undefined {
    try {
      switch (ev.type) {
        case "CheckedIn":
          return { type: ev.type, data: CheckedInSchema.parse(ev.data) }
        case "CheckedOut":
          return { type: ev.type, data: CheckedOutSchema.parse(ev.data) }
        case "Charged":
          return { type: ev.type, data: ChargedSchema.parse(ev.data) }
        case "Paid":
          return { type: ev.type, data: PaidSchema.parse(ev.data) }
      }
    } catch (err) {
      if (err instanceof ZodError) return undefined
      throw err
    }
  },
  encode(ev, ctx) {
    return {
      type: ev.type,
      data: ev.data,
      meta: {
        // matches ESDB's convention
        $correlationId: ctx.correlationId,
        $causationId: ctx.causationId,
        userId: ctx.userId,
        tenantId: ctx.tenantId
      }
    }
  }
}
```
