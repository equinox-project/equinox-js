import { PayerId, InvoiceId } from "./identifiers.js"
import z from "zod"
import { Codec, Decider, StreamId } from "@equinox-js/core"
import { reduce } from "ramda"
import * as Config from "../config/equinox.js"

export const CATEGORY = "Invoice"
export const streamId = StreamId.gen(InvoiceId.toString)
type InvoiceRaised = { payer_id: PayerId; amount: number }
type Payment = { amount: number; reference: string }

export type Event =
  | { type: "InvoiceRaised"; data: InvoiceRaised }
  | { type: "PaymentReceived"; data: Payment }
  | { type: "InvoiceFinalized" }

export const RaisedSchema = z.object({
  payer_id: z.string().transform(PayerId.parse),
  amount: z.number(),
})
export const PaymentSchema = z.object({ reference: z.string(), amount: z.number() })

export const codec = Codec.zod<Event>({
  InvoiceRaised: RaisedSchema.parse,
  PaymentReceived: PaymentSchema.parse,
  InvoiceFinalized: () => undefined,
})

// Fold
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

export const fold = reduce(evolve)

// Decisions

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

// Queries
export type Model = {
  amount: number
  payer_id: string
  finalized: boolean
}

export const summary = (state: State): Model | null => {
  switch (state.type) {
    case "Initial":
      return null
    case "Raised":
    case "Finalized":
      return {
        amount: state.state.amount,
        payer_id: PayerId.toString(state.state.payer_id),
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
    return decider.query(summary)
  }

  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory:
        return Config.MemoryStore.create(codec, fold, initial, config)
      case Config.Store.MessageDb:
        return Config.MessageDb.createUnoptimized(codec, fold, initial, config)
    }
  }

  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (id: InvoiceId) => Decider.resolve(category, CATEGORY, streamId(id), null)
    return new Service(resolve)
  }
}
