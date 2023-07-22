import { PayerId, InvoiceId } from "./types"
import * as Mdb from "@equinox-js/message-db"
import * as Mem from "@equinox-js/memory-store"
import z from "zod"
import { Codec, Decider, ICachingStrategy, StreamId } from "@equinox-js/core"

export const Category = "Invoice"
export const streamId = StreamId.gen(InvoiceId.toString)

const RaisedSchema = z.object({
  payer_id: z.string().uuid().transform(PayerId.parse),
  amount: z.number(),
})
const PaymentSchema = z.object({
  reference: z.string(),
  amount: z.number(),
})

type InvoiceRaised = z.infer<typeof RaisedSchema>
type Payment = z.infer<typeof PaymentSchema>

type Event =
  | { type: "InvoiceRaised"; data: InvoiceRaised }
  | { type: "PaymentReceived"; data: Payment }
  | { type: "InvoiceFinalized" }

const codec = Codec.zod<Event>({
  InvoiceRaised: RaisedSchema.parse,
  PaymentReceived: PaymentSchema.parse,
  InvoiceFinalized: () => undefined,
})

export type InvoiceState = {
  amount: number
  payer_id: PayerId
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
      payments: new Set(),
    },
  }
}

function evolveRaised(state: InvoiceState, event: Event): State {
  switch (event.type) {
    case "InvoiceRaised":
      throw new Error("Unexpected " + event.type)
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

export const raiseInvoice =
  (data: InvoiceRaised) =>
  (state: State): Event[] => {
    switch (state.type) {
      case "Initial":
        return [{ type: "InvoiceRaised", data }]
      case "Raised":
        if (state.state.amount === data.amount && state.state.payer_id === data.payer_id) return []
        throw new Error("Invoice is already raised")
      case "Finalized":
        throw new Error("invoice is finalized")
    }
  }

export const recordPayment =
  (data: Payment) =>
  (state: State): Event[] => {
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

export const finalize = (state: State): Event[] => {
  switch (state.type) {
    case "Initial":
      throw new Error("Invoice not found")
    case "Finalized":
      return []
    case "Raised":
      return [{ type: "InvoiceFinalized" }]
  }
}

export const summaryQuery = (state: State) => {
  switch (state.type) {
    case "Initial":
      return null
    case "Raised":
    case "Finalized":
      return {
        amount: state.state.amount,
        payer_id: state.state.payer_id.toString(),
        finalized: state.type === "Finalized",
      }
  }
}

export class Service {
  constructor(private readonly resolve: (invoiceId: InvoiceId) => Decider<Event, State>) {}

  raise(id: InvoiceId, data: InvoiceRaised) {
    const decider = this.resolve(id)
    return decider.transact(raiseInvoice(data))
  }

  recordPayment(id: InvoiceId, data: Payment) {
    const decider = this.resolve(id)
    return decider.transact(recordPayment(data))
  }

  finalize(id: InvoiceId) {
    const decider = this.resolve(id)
    return decider.transact(finalize)
  }

  readInvoice(id: InvoiceId) {
    const decider = this.resolve(id)
    return decider.query(summaryQuery)
  }

  static createMessageDb(context: Mdb.MessageDbContext, caching: ICachingStrategy) {
    const category = Mdb.MessageDbCategory.create(context, Category, codec, fold, initial, caching)
    const resolve = (invoiceId: InvoiceId) =>
      Decider.resolve(category, streamId(invoiceId), null)
    return new Service(resolve)
  }

  static createMem(store: Mem.VolatileStore<string>) {
    const category = Mem.MemoryStoreCategory.create(store, Category, codec, fold, initial)
    const resolve = (invoiceId: InvoiceId) =>
      Decider.resolve(category, streamId(invoiceId), null)
    return new Service(resolve)
  }
}
