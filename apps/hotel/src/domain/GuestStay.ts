import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { ChargeId, GroupCheckoutId, GuestStayId, PaymentId } from "./Types.js"
import { z } from "zod"
import { OffsetDateTime } from "@js-joda/core"
import { fields, variantModule, VariantOf } from "variant"
import { reduce } from "ramda"
import * as Config from "../config/equinox.js"

const data =
  <T>() =>
  (data: T) => ({ data })
const failwith = (msg: string): never => {
  throw new Error(msg)
}

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
    amount: z.number().int().gte(0),
  })
  const Paid = z.object({
    paymentId: z.string().transform(PaymentId.parse),
    at: OffsetDateTimeSchema,
    amount: z.number().int().gte(0),
  })
  const TransferredToGroup = z.object({
    groupId: z.string().transform(GroupCheckoutId.parse),
    at: OffsetDateTimeSchema,
    residualBalance: z.number().int().gte(0),
  })
  const CheckedOut = z.object({ at: OffsetDateTimeSchema })

  export type CheckedIn = z.infer<typeof CheckedIn>
  export type Charged = z.infer<typeof Charged>
  export type Paid = z.infer<typeof Paid>
  export type TransferredToGroup = z.infer<typeof TransferredToGroup>
  export type CheckedOut = z.infer<typeof CheckedOut>

  export const Event = variantModule({
    CheckedIn: data<CheckedIn>(),
    Charged: data<Charged>(),
    Paid: data<Paid>(),
    CheckedOut: data<CheckedOut>(),
    TransferredToGroup: data<TransferredToGroup>(),
  })

  export type Event = VariantOf<typeof Event>

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
  export const State = variantModule({
    Active: data<{
      balance: number
      charges: ChargeId[]
      payments: PaymentId[]
      checkedInAt?: OffsetDateTime
    }>(),
    Closed: {},
    TransferredToGroup: data<{
      at: OffsetDateTime
      residualBalance: number
      groupId: GroupCheckoutId
    }>(),
  })
  export type State = VariantOf<typeof State>

  export const initial = State.Active({ balance: 0, charges: [], payments: [] })

  function evolve(state: State, event: Events.Event) {
    switch (state.type) {
      case "Closed":
        return failwith("Invalid state transition")
      case "TransferredToGroup":
        return failwith("Invalid state transition")
      case "Active":
        switch (event.type) {
          case "CheckedIn":
            return State.Active({ ...state.data, checkedInAt: event.data.at })
          case "Charged":
            return State.Active({
              ...state.data,
              balance: state.data.balance + event.data.amount,
              charges: [...state.data.charges, event.data.chargeId],
            })
          case "Paid":
            return State.Active({
              ...state.data,
              balance: state.data.balance - event.data.amount,
              payments: [...state.data.payments, event.data.paymentId],
            })
          case "CheckedOut":
            return State.Closed()
          case "TransferredToGroup":
            return State.TransferredToGroup({
              at: event.data.at,
              residualBalance: state.data.balance,
              groupId: event.data.groupId,
            })
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
      if (state.type !== "Active") return failwith("Invalid checkin")
      if (state.data.checkedInAt) return []
      return [Events.Event.CheckedIn({ at })]
    }

  export const charge =
    (at: OffsetDateTime, chargeId: ChargeId, amount: number): Decision =>
    (state) => {
      if (state.type !== "Active") return failwith("Invalid charge")
      if (state.data.charges.includes(chargeId)) return []
      return [Events.Event.Charged({ chargeId, at, amount })]
    }

  export const payment =
    (at: OffsetDateTime, paymentId: PaymentId, amount: number): Decision =>
    (state) => {
      if (state.type !== "Active") return failwith("Invalid payment")
      if (state.data.payments.includes(paymentId)) return []
      return [Events.Event.Paid({ paymentId, at, amount })]
    }

  export const CheckoutResult = variantModule({
    Ok: {},
    AlreadyCheckedOut: {},
    BalanceOutstanding: data<{ balance: number }>(),
  })
  type CheckoutResult = VariantOf<typeof CheckoutResult>
  export const checkOut =
    (at: OffsetDateTime): DecisionResult<CheckoutResult> =>
    (state) => {
      switch (state.type) {
        case "Closed":
          return [CheckoutResult.Ok(), []]
        case "TransferredToGroup":
          return [CheckoutResult.AlreadyCheckedOut(), []]
        case "Active":
          return state.data.balance === 0
            ? [CheckoutResult.Ok(), [Events.Event.CheckedOut({ at })]]
            : [CheckoutResult.BalanceOutstanding({ balance: state.data.balance }), []]
      }
    }

  export const GroupCheckoutResult = variantModule({
    Ok: fields<{ residualBalance: number }>(),
    AlreadyCheckedOut: {},
  })
  type GroupCheckoutResult = VariantOf<typeof GroupCheckoutResult>

  export const groupCheckout =
    (at: OffsetDateTime, groupId: GroupCheckoutId): DecisionResult<GroupCheckoutResult> =>
    (state) => {
      switch (state.type) {
        case "Closed":
          return [GroupCheckoutResult.AlreadyCheckedOut(), []]
        case "TransferredToGroup":
          if (state.data.groupId === groupId) {
            return [GroupCheckoutResult.Ok({ residualBalance: state.data.residualBalance }), []]
          }
          return [CheckoutResult.AlreadyCheckedOut(), []]
        case "Active":
          return [
            GroupCheckoutResult.Ok({ residualBalance: state.data.balance }),
            [Events.Event.TransferredToGroup({ at, groupId, residualBalance: state.data.balance })],
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
