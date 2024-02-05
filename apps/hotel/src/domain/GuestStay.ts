import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { ChargeId, GroupCheckoutId, GuestStayId, PaymentId } from "./Types.js"
import { OffsetDateTime } from "@js-joda/core"
import * as Config from "../config/equinox.js"
import { createFold, upcast } from "./Utils.js"

export namespace Stream {
  export const category = "GuestStay"
  export const streamId = StreamId.gen(GuestStayId.toString)
  export const decodeId = StreamId.dec(GuestStayId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}

export namespace Events {
  export type CheckedIn = { at: OffsetDateTime }
  export type Charged = { chargeId: ChargeId; at: OffsetDateTime; amount: number }
  export type Paid = { paymentId: PaymentId; at: OffsetDateTime; amount: number }
  export type TransferredToGroup = {
    groupId: GroupCheckoutId
    at: OffsetDateTime
    residualBalance: number
  }
  export type CheckedOut = { at: OffsetDateTime }

  export type Event =
    | { type: "CheckedIn"; data: CheckedIn }
    | { type: "Charged"; data: Charged }
    | { type: "Paid"; data: Paid }
    | { type: "CheckedOut"; data: CheckedOut }
    | { type: "TransferredToGroup"; data: TransferredToGroup }

  export const CheckedIn = (data: CheckedIn): Event => ({ type: "CheckedIn", data })
  export const Charged = (data: Charged): Event => ({ type: "Charged", data })
  export const Paid = (data: Paid): Event => ({ type: "Paid", data })
  export const CheckedOut = (data: CheckedOut): Event => ({ type: "CheckedOut", data })
  export const TransferredToGroup = (data: TransferredToGroup): Event => ({
    type: "TransferredToGroup",
    data,
  })

  export const codec = Codec.upcast<Event>(Codec.json(), upcast)
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

  export const fold = createFold<Events.Event, State>({
    CheckedIn(state, { at }) {
      if (state.type !== "Active") throw new Error("Invalid state transition")
      state.checkedInAt = at
    },
    Charged(state, { chargeId, amount }) {
      if (state.type !== "Active") throw new Error("Invalid state transition")
      state.balance += amount
      state.charges.push(chargeId)
    },
    Paid(state, { paymentId, amount }) {
      if (state.type !== "Active") throw new Error("Invalid state transition")
      state.balance -= amount
      state.payments.push(paymentId)
    },
    CheckedOut(state) {
      if (state.type !== "Active") throw new Error("Invalid state transition")
      return { type: "Closed" }
    },
    TransferredToGroup(state, { at, groupId, residualBalance }) {
      if (state.type !== "Active") throw new Error("Invalid state transition")
      return { type: "TransferredToGroup", at, residualBalance, groupId }
    },
  })
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
      return [Events.CheckedIn({ at })]
    }

  export const charge =
    (at: OffsetDateTime, chargeId: ChargeId, amount: number): Decision =>
    (state) => {
      if (state.type !== "Active") throw new Error("Invalid charge")
      if (state.charges.includes(chargeId)) return []
      return [Events.Charged({ chargeId, at, amount })]
    }

  export const payment =
    (at: OffsetDateTime, paymentId: PaymentId, amount: number): Decision =>
    (state) => {
      if (state.type !== "Active") throw new Error("Invalid payment")
      if (state.payments.includes(paymentId)) return []
      return [Events.Paid({ paymentId, at, amount })]
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
            ? [{ type: "Ok" }, [Events.CheckedOut({ at })]]
            : [{ type: "BalanceOutstanding", balance: state.balance }, []]
      }
    }

  type GroupCheckoutResult = { type: "Ok"; residualBalance: number } | { type: "AlreadyCheckedOut" }

  export const transferToGroup =
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
            [Events.TransferredToGroup({ at, groupId, residualBalance: state.balance })],
          ]
      }
    }
}

export class Service {
  constructor(private readonly resolve: (id: GuestStayId) => Decider<Events.Event, Fold.State>) {}

  checkIn(id: GuestStayId, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transact(Decide.checkIn(at))
  }

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

  // driven exclusively by the `GroupCheckoutProcessor`
  transferToGroup(id: GuestStayId, groupId: GroupCheckoutId, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transactResult(Decide.transferToGroup(at, groupId))
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
