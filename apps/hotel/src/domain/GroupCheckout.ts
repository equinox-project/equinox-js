import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { GroupCheckoutId, GuestStayId, PaymentId } from "./Types.js"
import { OffsetDateTime } from "@js-joda/core"
import { createFold, data, sumBy, upcast } from "./Utils.js"
import * as Config from "../config/equinox.js"
import { VariantOf, variantModule } from "variant"

export namespace Stream {
  export const category = "GroupCheckout"
  export const streamId = StreamId.gen(GroupCheckoutId.toString)
  export const decodeId = StreamId.dec(GroupCheckoutId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}

export namespace Events {
  export type CheckoutResidual = { stay: GuestStayId; residual: number }
  const Event = variantModule({
    StaysSelected: data<{ stays: GuestStayId[]; at: OffsetDateTime }>(),
    StaysMerged: data<{ residuals: CheckoutResidual[] }>(),
    MergesFailed: data<{ stays: GuestStayId[] }>(),
    Paid: data<{ paymentId: PaymentId; at: OffsetDateTime; amount: number }>(),
    Confirmed: data<{ at: OffsetDateTime }>(),
  })
  export const { StaysSelected, StaysMerged, MergesFailed, Paid, Confirmed } = Event
  export type Event = VariantOf<typeof Event>

  export const codec = Codec.upcast<Event>(Codec.json(), upcast)
}

export namespace Fold {
  export type State = {
    pending: Set<GuestStayId>
    checkedOut: Map<GuestStayId, number>
    failed: GuestStayId[]
    balance: number
    payments: PaymentId[]
    completed: boolean
  }
  export const initial: State = {
    pending: new Set(),
    checkedOut: new Map(),
    failed: [],
    balance: 0,
    payments: [],
    completed: false,
  }

  export const fold = createFold<Events.Event, State>({
    StaysSelected(state, { stays }) {
      for (const id of stays) state.pending.add(id)
    },
    StaysMerged(state, { residuals }) {
      for (const { stay } of residuals) state.pending.delete(stay)
      for (const x of residuals) state.checkedOut.set(x.stay, x.residual)
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
    if (state.pending.size > 0) return { type: "MergeStays", stays: Array.from(state.pending) }
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
      for (const id of state.checkedOut.keys()) registered.add(id)
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
      ok: s.checkedOut.size,
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
