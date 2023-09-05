import { PayerId, InvoiceId } from "./identifiers.js"
import z from "zod"
import { Codec, Decider, LoadOption, StreamId, StreamName } from "@equinox-js/core"
import { reduce } from "ramda"
import * as Config from "../config/equinox.js"

export namespace Stream {
  export const CATEGORY = "Invoice"
  export const streamId = StreamId.gen(InvoiceId.toString)
  export const decodeId = StreamId.dec(InvoiceId.parse)
  export const tryMatch = StreamName.tryMatch(CATEGORY, decodeId)
}

export namespace Events {
  export const InvoiceRaised = z.object({
    payer_id: z.string().transform(PayerId.parse),
    amount: z.number(),
    due_date: z
      .string()
      .datetime()
      .transform((x) => new Date(x)),
  })
  export type InvoiceRaised = z.infer<typeof InvoiceRaised>

  export const Payment = z.object({ reference: z.string(), amount: z.number() })
  export type Payment = z.infer<typeof Payment>

  export type Event =
    | { type: "InvoiceRaised"; data: InvoiceRaised }
    | { type: "PaymentReceived"; data: Payment }
    | { type: "InvoiceFinalized" }

  export const codec = Codec.upcast<Event>(
    Codec.json(),
    Codec.Upcast.body({
      InvoiceRaised: InvoiceRaised.parse,
      PaymentReceived: Payment.parse,
      InvoiceFinalized: () => undefined,
    }),
  )
}

export namespace Fold {
  import Event = Events.Event
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
}

export namespace Decide {
  import Event = Events.Event
  import State = Fold.State

  export const raiseInvoice =
    (data: Events.InvoiceRaised) =>
    (state: State): Event[] => {
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

  export const recordPayment =
    (data: Events.Payment) =>
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
}

namespace Query {
  export type Model = {
    amount: number
    payer_id: string
    finalized: boolean
  }

  export const summary = (state: Fold.State): Model | null => {
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
}

export class Service {
  constructor(
    private readonly resolve: (invoiceId: InvoiceId) => Decider<Events.Event, Fold.State>,
  ) {}

  raise(id: InvoiceId, data: Events.InvoiceRaised) {
    const decider = this.resolve(id)
    return decider.transact(Decide.raiseInvoice(data), LoadOption.AssumeEmpty)
  }

  recordPayment(id: InvoiceId, data: Events.Payment) {
    const decider = this.resolve(id)
    return decider.transact(Decide.recordPayment(data))
  }

  finalize(id: InvoiceId) {
    const decider = this.resolve(id)
    return decider.transact(Decide.finalize)
  }

  readInvoice(id: InvoiceId) {
    const decider = this.resolve(id)
    return decider.query(Query.summary)
  }

  // prettier-ignore
  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory: return Config.MemoryStore.create(Stream.CATEGORY, Events.codec, Fold.fold, Fold.initial, config)
      case Config.Store.MessageDb: return Config.MessageDb.createUnoptimized(Stream.CATEGORY, Events.codec, Fold.fold, Fold.initial, config)
      case Config.Store.Dynamo: return Config.Dynamo.createUnoptimized(Stream.CATEGORY, Events.codec, Fold.fold, Fold.initial, config)
    }
  }

  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (id: InvoiceId) => Decider.forStream(category, Stream.streamId(id), null)
    return new Service(resolve)
  }
}
