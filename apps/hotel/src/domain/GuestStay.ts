import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { ChargeId, GroupCheckoutId, GuestStayId, PaymentId } from "./Types.js"
import { z } from "zod"
import { OffsetDateTime } from "@js-joda/core"
import { reduce } from "ramda"
import * as Config from "../config/equinox.js"

export namespace Stream {
  export const category = "GuestStay"
  export const streamId = StreamId.gen(GuestStayId.toString)
  export const decodeId = StreamId.dec(GuestStayId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}

export namespace Events {
  const OffsetDateTimeSchema = z.string().transform((s) => OffsetDateTime.parse(s))
  const CheckedIn = z.object({ at: OffsetDateTimeSchema })
  const Charged = z.object({
    chargeId: z.string().transform(ChargeId.parse),
    at: OffsetDateTimeSchema,
    amount: z.number(),
  })
  const Paid = z.object({
    paymentId: z.string().transform(PaymentId.parse),
    at: OffsetDateTimeSchema,
    amount: z.number(),
  })
  const TransferredToGroup = z.object({
    groupId: z.string().transform(GroupCheckoutId.parse),
    at: OffsetDateTimeSchema,
    residualBalance: z.number(),
  })
  const CheckedOut = z.object({ at: OffsetDateTimeSchema })

  export type CheckedIn = z.infer<typeof CheckedIn>
  export type Charged = z.infer<typeof Charged>
  export type Paid = z.infer<typeof Paid>
  export type TransferredToGroup = z.infer<typeof TransferredToGroup>
  export type CheckedOut = z.infer<typeof CheckedOut>

  export type Event =
    | { type: "CheckedIn"; data: CheckedIn }
    | { type: "Charged"; data: Charged }
    | { type: "Paid"; data: Paid }
    | { type: "CheckedOut"; data: CheckedOut }
    | { type: "TransferredToGroup"; data: TransferredToGroup }

  export const codec = Codec.upcast<Event>(
    Codec.json(),
    Codec.Upcast.body({
      CheckedIn: CheckedIn.parse,
      Charged: Charged.parse,
      Paid: Paid.parse,
      CheckedOut: CheckedOut.parse,
      TransferredToGroup: TransferredToGroup.parse,
    }),
  )
}

export namespace Fold {
  export type State =
    | {
        type: "Active"
        balance: number
        charges: ChargeId[]
        payments: PaymentId[]
        checkedInAt?: OffsetDateTime
      }
    | { type: "Closed" }
    | {
        type: "TransferredToGroup"
        at: OffsetDateTime
        residualBalance: number
        groupId: GroupCheckoutId
      }

  export const initial: State = { type: "Active", balance: 0, charges: [], payments: [] }

  function evolve(state: State, event: Events.Event): State {
    switch (state.type) {
      case "Closed":
        throw new Error("Invalid state transition")
      case "TransferredToGroup":
        throw new Error("Invalid state transition")
      case "Active":
        switch (event.type) {
          case "CheckedIn":
            return { ...state, checkedInAt: event.data.at }
          case "Charged":
            return {
              ...state,
              balance: state.balance + event.data.amount,
              charges: [...state.charges, event.data.chargeId],
            }
          case "Paid":
            return {
              ...state,
              balance: state.balance - event.data.amount,
              payments: [...state.payments, event.data.paymentId],
            }
          case "CheckedOut":
            return { type: "Closed" }
          case "TransferredToGroup":
            return {
              type: "TransferredToGroup",
              at: event.data.at,
              residualBalance: state.balance,
              groupId: event.data.groupId,
            }
        }
    }
  }

  export const fold = reduce(evolve)
}

export namespace Decide {
  import State = Fold.State
  import Event = Events.Event

  type Decision = (state: State) => Event[]
  type DecisionResult<T> = (state: State) => [T, Event[]]

  export const checkIn =
    (at: OffsetDateTime): Decision =>
    (state) => {
      if (state.type !== "Active") throw new Error("Invalid checkin")
      if (state.checkedInAt) return []
      return [{ type: "CheckedIn", data: { at } }]
    }

  export const charge =
    (at: OffsetDateTime, chargeId: ChargeId, amount: number): Decision =>
    (state) => {
      if (state.type !== "Active") throw new Error("Invalid charge")
      if (state.charges.includes(chargeId)) return []
      return [{ type: "Charged", data: { chargeId, at, amount } }]
    }

  export const payment =
    (at: OffsetDateTime, paymentId: PaymentId, amount: number): Decision =>
    (state) => {
      if (state.type !== "Active") throw new Error("Invalid payment")
      if (state.payments.includes(paymentId)) return []
      return [{ type: "Paid", data: { paymentId, at, amount } }]
    }

  type CheckoutResult =
    | { type: "Ok" }
    | { type: "AlreadyCheckedOut" }
    | { type: "BalanceOutstanding"; balance: number }

  export const checkOut =
    (at: OffsetDateTime): DecisionResult<CheckoutResult> =>
    (state) => {
      switch (state.type) {
        case "Closed":
          return [{ type: "Ok" }, []]
        case "TransferredToGroup":
          return [{ type: "AlreadyCheckedOut" }, []]
        case "Active":
          return state.balance === 0
            ? [{ type: "Ok" }, [{ type: "CheckedOut", data: { at } }]]
            : [{ type: "BalanceOutstanding", balance: state.balance }, []]
      }
    }

  type GroupCheckoutResult = { type: "Ok"; residualBalance: number } | { type: "AlreadyCheckedOut" }

  export const groupCheckout =
    (at: OffsetDateTime, groupId: GroupCheckoutId): DecisionResult<GroupCheckoutResult> =>
    (state) => {
      switch (state.type) {
        case "Closed":
          return [{ type: "AlreadyCheckedOut" }, []]
        case "TransferredToGroup":
          if (state.groupId === groupId) {
            return [{ type: "Ok", residualBalance: state.residualBalance }, []]
          }
          return [{ type: "AlreadyCheckedOut" }, []]
        case "Active":
          return [
            { type: "Ok", residualBalance: state.balance },
            [{ type: "TransferredToGroup", data: { at, groupId, residualBalance: state.balance } }],
          ]
      }
    }
}

export class Service {
  constructor(private readonly resolve: (id: GuestStayId) => Decider<Events.Event, Fold.State>) {}

  charge(id: GuestStayId, chargeId: ChargeId, amount: number, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transact(Decide.charge(at, chargeId, amount))
  }

  pay(id: GuestStayId, paymentId: PaymentId, amount: number, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transact(Decide.payment(at, paymentId, amount))
  }

  checkOut(id: GuestStayId, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transactResult(Decide.checkOut(at))
  }

  // driven exclusively by GroupCheckout
  groupCheckout(id: GuestStayId, groupId: GroupCheckoutId, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transactResult(Decide.groupCheckout(at, groupId))
  }

  // prettier-ignore
  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.MessageDb: return Config.MessageDb.createUnoptimized(Stream.category, Events, Fold, config)
      case Config.Store.Memory: return Config.MemoryStore.create(Stream.category, Events, Fold, config)
      case Config.Store.Dynamo: return Config.Dynamo.createUnoptimized(Stream.category, Events, Fold, config)
    }
  }

  // prettier-ignore
  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (id: GuestStayId) => Decider.forStream(category, Stream.streamId(id), null)
    return new Service(resolve)
  }
}
