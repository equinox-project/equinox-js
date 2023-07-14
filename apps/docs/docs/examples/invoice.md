# Invoice

Based on the blog post on [The Equinox Programming Model](https://nordfjord.io/2022/12/05/equinox.html)

```ts
import { PayerId, InvoiceId } from "./types"
import * as Mdb from "@equinox-js/message-db"
import * as Mem from "@equinox-js/memory-store"
import z from "zod"
import { ICodec, Decider, ICachingStrategy } from "@equinox-js/core"

export const Category = "Invoice"
export const streamId = (invoiceId: InvoiceId) => invoiceId.toString()
type InvoiceRaised = { payer_id: PayerId; amount: number }
type Payment = { amount: number; reference: string }
type EmailReceipt = { idempotency_key: string; recipient: string; sent_at: Date }

type Event =
  | { type: "InvoiceRaised"; data: InvoiceRaised }
  | { type: "InvoiceEmailed"; data: EmailReceipt }
  | { type: "PaymentReceived"; data: Payment }
  | { type: "InvoiceFinalized" }

const RaisedSchema = z.object({
  invoice_number: z.number().int(),
  payer_id: z.string().transform((s) => s as PayerId),
  amount: z.number(),
})
const PaymentSchema = z.object({ reference: z.string(), amount: z.number() })
const EmailReceiptSchema = z.object({
  idempotency_key: z.string(),
  recipient: z.string().email(),
  sent_at: z.date(),
})

export const codec: ICodec<Event, string> = {
  tryDecode(ev): Event | undefined {
    switch (ev.type) {
      case "InvoiceRaised":
        return { type: "InvoiceRaised", data: RaisedSchema.parse(JSON.parse(ev.data!)) }
      case "InvoiceEmailed":
        return { type: ev.type, data: EmailReceiptSchema.parse(JSON.parse(ev.data!)) }
      case "PaymentReceived":
        return { type: ev.type, data: PaymentSchema.parse(JSON.parse(ev.data!)) }
      case "InvoiceFinalized":
        return { type: ev.type }
    }
  },
  encode(ev) {
    return { type: ev.type, data: "data" in ev ? JSON.stringify(ev.data) : undefined }
  },
}

namespace Fold {
  export type InvoiceState = {
    amount: number
    payer_id: PayerId
    emailed_to: Set<string>
    payments: Set<string>
    amount_paid: number
  }
  export type State =
    | { type: "Initial" }
    | { type: "Raised"; state: InvoiceState }
    | { type: "Finalized"; state: InvoiceState }
  export const initial: State = { type: "Initial" }

  function evolveInitial(event: Event): State {
    if (event.type !== "InvoiceRaised") throw new Error("Unexpected " + event.type)
    return {
      type: "Raised",
      state: {
        amount: event.data.amount,
        payer_id: event.data.payer_id,
        amount_paid: 0,
        emailed_to: new Set(),
        payments: new Set(),
      },
    }
  }

  function evolveRaised(state: InvoiceState, event: Event): State {
    switch (event.type) {
      case "InvoiceRaised":
        throw new Error("Unexpected " + event.type)
      case "InvoiceEmailed":
        return {
          type: "Raised",
          state: { ...state, emailed_to: new Set([...state.emailed_to, event.data.recipient]) },
        }
      case "PaymentReceived":
        return {
          type: "Raised",
          state: {
            ...state,
            payments: new Set([...state.payments, event.data.reference]),
            amount_paid: state.amount_paid + event.data.amount,
          },
        }

      case "InvoiceFinalized":
        return { type: "Finalized", state }
    }
  }

  function evolveFinalized(event: Event): State {
    throw new Error("Unexpected " + event.type)
  }

  export function evolve(state: State, event: Event): State {
    switch (state.type) {
      case "Initial":
        return evolveInitial(event)
      case "Raised":
        return evolveRaised(state.state, event)
      case "Finalized":
        return evolveFinalized(event)
    }
  }

  export function fold(state: State, events: Event[]): State {
    return events.reduce(evolve, state)
  }
}

namespace Decide {
  export const raiseInvoice =
    (data: InvoiceRaised) =>
      (state: Fold.State): Event[] => {
        switch (state.type) {
          case "Initial":
            return [{ type: "InvoiceRaised", data }]
          case "Raised":
            if (state.state.amount === data.amount && state.state.payer_id === data.payer_id)
              return []
            throw new Error("Invoice is already raised")
          case "Finalized":
            throw new Error("invoice is finalized")
        }
      }

  const hasSentEmailToRecipient = (recipient: string, state: Fold.InvoiceState) =>
    state.emailed_to.has(recipient)
  export const recordEmailReceipt =
    (data: EmailReceipt) =>
      (state: Fold.State): Event[] => {
        switch (state.type) {
          case "Initial":
            throw new Error("Invoice not found")
          case "Finalized":
            throw new Error("Invoice is finalized")
          case "Raised":
            if (hasSentEmailToRecipient(data.recipient, state.state)) return []
            return [{ type: "InvoiceEmailed", data }]
        }
      }

  export const recordPayment =
    (data: Payment) =>
      (state: Fold.State): Event[] => {
        switch (state.type) {
          case "Initial":
            throw new Error("Invoice not found")
          case "Finalized":
            throw new Error("Invoice is finalized")
          case "Raised":
            if (state.state.payments.has(data.reference)) return []
            return [{ type: "PaymentReceived", data }]
        }
      }

  export const finalize = (state: Fold.State): Event[] => {
    switch (state.type) {
      case "Initial":
        throw new Error("Invoice not found")
      case "Finalized":
        return []
      case "Raised":
        return [{ type: "InvoiceFinalized" }]
    }
  }
}

namespace Queries {
  import InvoiceState = Fold.InvoiceState
  import State = Fold.State
  export type Model = {
    amount: number
    payer_id: string
    emailed_to: string[]
    finalized: boolean
  }

  export const fromState = (finalized: boolean, state: InvoiceState) => ({
    amount: state.amount,
    payer_id: state.payer_id.toString(),
    emailed_to: Array.from(state.emailed_to),
    finalized,
  })

  export const summary = (state: State): Model | null => {
    switch (state.type) {
      case "Initial":
        return null
      case "Raised":
        return fromState(false, state.state)
      case "Finalized":
        return fromState(true, state.state)
    }
  }
}

export class Service {
  constructor(private readonly resolve: (invoiceId: InvoiceId) => Decider<Event, Fold.State>) {}

  raise(id: InvoiceId, data: InvoiceRaised) {
    const decider = this.resolve(id)
    return decider.transact(Decide.raiseInvoice(data))
  }

  recordEmailReceipt(id: InvoiceId, data: EmailReceipt) {
    const decider = this.resolve(id)
    return decider.transact(Decide.recordEmailReceipt(data))
  }

  recordPayment(id: InvoiceId, data: Payment) {
    const decider = this.resolve(id)
    return decider.transact(Decide.recordPayment(data))
  }

  finalize(id: InvoiceId) {
    const decider = this.resolve(id)
    return decider.transact(Decide.finalize)
  }

  readInvoice(id: InvoiceId) {
    const decider = this.resolve(id)
    return decider.query(Queries.summary)
  }

  static createMessageDb(context: Mdb.MessageDbContext, caching: ICachingStrategy) {
    const category = Mdb.MessageDbCategory.create(context, codec, Fold.fold, Fold.initial, caching)
    const resolve = (invoiceId: InvoiceId) =>
      Decider.resolve(category, Category, streamId(invoiceId), null)
    return new Service(resolve)
  }

  static createMem(store: Mem.VolatileStore<string>) {
    const category = Mem.MemoryStoreCategory.create(store, codec, Fold.fold, Fold.initial)
    const resolve = (invoiceId: InvoiceId) =>
      Decider.resolve(category, Category, streamId(invoiceId), null)
    return new Service(resolve)
  }
}
```