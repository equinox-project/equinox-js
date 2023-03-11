---
sidebar_position: 1
---

# Equinox JS 

EquinoxJS is a ground-up re-implementation of the Equinox project, an F# event sourcing library. It provides a programming model centered around Deciders as the central domain abstraction.

# Quick example

```ts
import {
  MessageDbContext,
  MessageDbCategory,
  CachingStrategy as MessageDbCachingStrategy
} from "@equinox-js/message-db"
import {
  DynamoCachingStrategy,
  DynamoStoreCategory,
  CachingStrategy as DynamoCachingStrategy
} from "@equinox-js/dynamo-store"
import { MemoryStoreCategory, VolatileStore } from "./index"

type InvoiceRaised = { payer: string; amount: number }
type Payment = { amount: number; reference: string }

type Event =
  | { type: "InvoiceRaised", data: InvoiceRaised }
  | { type: "PaymentReceived", data: Payment }
  | { type: "InvoiceFinalized" }

type InvoiceState = {
  amount: number;
  payer: string;
  payments: Set<string>;
  amount_paid: number;
}
type State =
  | { type: "Initial" }
  | { type: "Raised", data: InvoiceState }
  | { type: "Finalized", data: InvoiceState }
const initial: State = { type: "Initial" }

const evolve = (state: State, event: Event): State => {
  switch (state.type) {
    case "Initial":
      if (event.type !== "InvoiceRaised") throw new Error("Unexpected event " + event.type)
      return {
        type: "Raised",
        data: { amount: event.data.amount, payer: event.data.payer, payments: new Set(), amount_paid: 0 }
      }
    case "Raised":
      switch (event.type) {
        case "InvoiceRaised":
          throw new Error("Unexpected event " + event.type)
        case "PaymentReceived":
          return {
            type: "Raised",
            data: {
              ...state.data,
              payments: new Set([...state.data.payments, event.data.reference]),
              amount_paid: event.data.amount + state.data.amount_paid
            }
          }
        case "InvoiceFinalized":
          return { type: "Finalized", data: state.data }
      }
    case "Finalized":
      throw new Error("Unexpected event in finalized state: " + event.type)
  }
}

const raiseInvoice = (data: InvoiceRaised) => (state: State): Event[] => {
  switch (state.type) {
    case "Initial":
      return [{ type: "InvoiceRaised", data }]
    case "Raised":
      if (state.data.amount === data.amount && state.data.payer === data.payer) return []
      throw new Error("Invoice is already raised")
    case "Finalized":
      throw new Error("Invoice is finalized")
  }
}

const recordPayment = (data: Payment) => (state: State): Event[] => {
  switch (state.type) {
    case "Initial":
      throw new Error("Invoice not found")
    case "Raised":
      if (state.data.payments.has(data.reference)) return []
      return [{ type: "PaymentReceived", data }]
    case "Finalized":
      throw new Error("Invoice is finalized")
  }
}

const finalizeInvoice = (state: State): Event[] => {
  switch (state.type) {
    case "Initial":
      throw new Error("Invoice not found")
    case "Raised":
      return [{ type: "InvoiceFinalized" }]
    case "Finalized":
      return []
  }
}

const Category = "Invoice"
const streamId = (invoiceId: string) => invoiceId.replace(/-/g, "")

class Service {
  constructor(private readonly resolve: (invoiceId: string) => Decider<Event, State>) {
  }

  raiseInvoice(invoiceId: string, data: InvoiceRaised) {
    const decider = this.resolve(invoiceId)
    return decider.transact(raiseInvoice(data))
  }

  recordPayment(invoiceId: string, data: Payment) {
    const decider = this.resolve(invoiceId)
    return decider.transact(recordPayment(data))
  }

  finalizeInvoice(invoiceId: string) {
    const decider = this.resolve(invoiceId)
    return decider.transact(finalizeInvoice)
  }

  readInvoice(invoiceId: string) {
    const decider = this.resolve(invoiceId)
    return decider.query(state => {
      switch (state.type) {
        case "Initial":
          return null
        case "Raised":
          return { ...state.data, status: "Raised" }
        case "Finalized":
          return { ...state.data, status: "Finalized" }
      }
    })
  }

  static buildMessageDb(context: MessageDbContext, cache: MessageDbCachingStrategy) {
    const category = MessageDbCategory.build(context, identityCodec, fold, initial, cache)
    const resolve = (invoiceId: string) => Decider.resolve(category, Category, streamId(invoiceId), null)
    return new Service(resolve)
  }

  static buildDynamoDb(context: DynamoStoreContext, cache: DynamoCachingStrategy) {
    const category = DynamoStoreCategory.build(context, identityCodec, fold, initial, cache)
    const resolve = (invoiceId: string) => Decider.resolve(category, Category, streamId(invoiceId), null)
    return new Service(resolve)
  }

  static buildMem(store: VolatileStore) {
    const category = MemoryStoreCategory.build(store, identityCodec, fold, initial)
    const resolve = (invoiceId: string) => Decider.resolve(category, Category, streamId(invoiceId), null)
    return new Service(resolve)
  }
}
```
