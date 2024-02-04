import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { GroupCheckoutId, GuestStayId, PaymentId } from "./Types.js"
import { OffsetDateTime } from "@js-joda/core"
import { createFold, sumBy, upcast } from "./Utils.js"
import * as Config from "../config/equinox.js"

export namespace Stream {
  export const category = "GroupCheckout"
  export const streamId = StreamId.gen(GroupCheckoutId.toString)
  export const decodeId = StreamId.dec(GroupCheckoutId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}

export namespace Events {
  export type CheckoutResidual = { stay: GuestStayId; residual: number }
  type StaysSelected = { stays: GuestStayId[]; at: OffsetDateTime }
  type StaysMerged = { residuals: CheckoutResidual[] }
  type MergesFailed = { stays: GuestStayId[] }
  type Paid = { paymentId: PaymentId; at: OffsetDateTime; amount: number }
  type Confirmed = { at: OffsetDateTime }

  export type Event =
    | { type: "StaysSelected"; data: StaysSelected }
    | { type: "StaysMerged"; data: StaysMerged }
    | { type: "MergesFailed"; data: MergesFailed }
    | { type: "Paid"; data: Paid }
    | { type: "Confirmed"; data: Confirmed }

  export const StaysSelected = (data: StaysSelected): Event => ({ type: "StaysSelected", data })
  export const StaysMerged = (data: StaysMerged): Event => ({ type: "StaysMerged", data })
  export const MergesFailed = (data: MergesFailed): Event => ({ type: "MergesFailed", data })
  export const Paid = (data: Paid): Event => ({ type: "Paid", data })
  export const Confirmed = (data: Confirmed): Event => ({ type: "Confirmed", data })

  export const codec = Codec.upcast<Event>(Codec.json(), upcast)
}

export namespace Fold {
  export type State = {
    pending: GuestStayId[]
    checkedOut: Events.CheckoutResidual[]
    failed: GuestStayId[]
    balance: number
    payments: PaymentId[]
    completed: boolean
  }
  export const initial: State = {
    pending: [],
    checkedOut: [],
    failed: [],
    balance: 0,
    payments: [],
    completed: false,
  }

  export const fold = createFold<Events.Event, State>({
    StaysSelected(state, { stays }) {
      state.pending.push(...stays)
    },
    StaysMerged(state, { residuals }) {
      const stayIds = new Set(residuals.map((x) => x.stay))
      state.pending = state.pending.filter((x) => !stayIds.has(x))
      state.checkedOut.push(...residuals)
      state.balance += sumBy(residuals, (x) => x.residual)
    },
    MergesFailed(state, { stays }) {
      state.failed.push(...stays)
    },
    Paid(state, { paymentId, amount }) {
      state.balance -= amount
      state.payments.push(paymentId)
    },
    Confirmed(state) {
      state.completed = true
    },
  })
}

export namespace Flow {
  export type State =
    | { type: "MergeStays"; stays: GuestStayId[] }
    | { type: "Ready"; balance: number }
    | { type: "Finished" }

  export const nextAction = (state: Fold.State): State => {
    if (state.completed) return { type: "Finished" }
    if (state.pending.length > 0) return { type: "MergeStays", stays: state.pending }
    return { type: "Ready", balance: state.balance }
  }

  export const decide =
    (handleAction: (state: State) => Promise<Events.Event[]>) => (state: Fold.State) =>
      handleAction(nextAction(state))
}

export namespace Decide {
  import State = Fold.State
  import Event = Events.Event

  type Decision = (state: State) => Event[]
  type DecisionResult<T> = (state: State) => [T, Event[]]

  export const add =
    (at: OffsetDateTime, stays: GuestStayId[]): Decision =>
    (state) => {
      const registered = new Set<GuestStayId>()
      for (const id of state.pending) registered.add(id)
      for (const id of state.failed) registered.add(id)
      for (const x of state.checkedOut) registered.add(x.stay)
      stays = stays.filter((x) => !registered.has(x))
      if (stays.length === 0) return []
      return [Events.StaysSelected({ stays, at })]
    }

  type ConfirmResult =
    | { type: "Processing" }
    | { type: "Ok" }
    | { type: "BalanceOutstanding"; balance: number }

  export const confirm =
    (at: OffsetDateTime): DecisionResult<ConfirmResult> =>
    (state) => {
      const action = Flow.nextAction(state)
      switch (action.type) {
        case "Finished":
          return [{ type: "Ok" }, []]
        case "Ready":
          if (state.balance === 0) return [{ type: "Ok" }, [Events.Confirmed({ at })]]
          return [{ type: "BalanceOutstanding", balance: state.balance }, []]
        case "MergeStays":
          return [{ type: "Processing" }, []]
      }
    }

  export const pay =
    (paymentId: PaymentId, at: OffsetDateTime, amount: number): Decision =>
    (state) => {
      if (state.payments.includes(paymentId)) return []
      return [Events.Paid({ paymentId, at, amount })]
    }
}

export class Service {
  constructor(
    private readonly resolve: (id: GroupCheckoutId) => Decider<Events.Event, Fold.State>,
  ) {}

  merge(id: GroupCheckoutId, stays: GuestStayId[], at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transactProject(Decide.add(at, stays), Flow.nextAction)
  }

  pay(id: GroupCheckoutId, paymentId: PaymentId, amount: number, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transact(Decide.pay(paymentId, at, amount))
  }

  confirm(id: GroupCheckoutId, at = OffsetDateTime.now()) {
    const decider = this.resolve(id)
    return decider.transactResult(Decide.confirm(at))
  }

  react(id: GroupCheckoutId, handleRection: (state: Flow.State) => Promise<Events.Event[]>) {
    const decider = this.resolve(id)
    return decider.transactVersionAsync(Flow.decide(handleRection))
  }

  read(id: GroupCheckoutId) {
    const decider = this.resolve(id)
    return decider.query(Flow.nextAction)
  }

  readResult(id: GroupCheckoutId) {
    const decider = this.resolve(id)
    return decider.query((s) => ({
      ok: s.checkedOut.length,
      failed: s.failed.length,
    }))
  }

  // prettier-ignore
  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory: return Config.MemoryStore.create(Stream.category, Events, Fold, config)
      case Config.Store.MessageDb: return Config.MessageDb.createUnoptimized(Stream.category, Events, Fold, config)
      case Config.Store.Dynamo: return Config.Dynamo.createUnoptimized(Stream.category, Events, Fold, config)
    }
  }

  // prettier-ignore
  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (id: GroupCheckoutId) => Decider.forStream(category, Stream.streamId(id), null)
    return new Service(resolve)
  }
}
