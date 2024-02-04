import { Codec, Decider, StreamId, StreamName } from "@equinox-js/core"
import { GroupCheckoutId, GuestStayId, PaymentId, data } from "./Types.js"
import { z } from "zod"
import { OffsetDateTime } from "@js-joda/core"
import { VariantOf, fields, variantModule } from "variant"
import { sumBy } from "./Utils.js"
import { reduce } from "ramda"
import * as Config from "../config/equinox.js"

export namespace Stream {
  export const category = "GroupCheckout"
  export const streamId = StreamId.gen(GroupCheckoutId.toString)
  export const decodeId = StreamId.dec(GroupCheckoutId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}

export namespace Events {
  export const OffsetDateTimeSchema = z.string().transform((s) => OffsetDateTime.parse(s))
  export const CheckoutResidual = z.object({
    stay: z.string().transform(GuestStayId.parse),
    residual: z.number().int().gte(0),
  })
  export const StaysSelected = z.object({
    stays: z.array(z.string().transform(GuestStayId.parse)),
    at: OffsetDateTimeSchema,
  })
  export const StaysMerged = z.object({
    residuals: z.array(CheckoutResidual),
  })
  export const MergesFailed = z.object({
    stays: z.array(z.string().transform(GuestStayId.parse)),
  })
  export const Paid = z.object({
    at: OffsetDateTimeSchema,
    paymentId: z.string().transform(PaymentId.parse),
    amount: z.number().int().gte(0),
  })
  export const Confirmed = z.object({
    at: OffsetDateTimeSchema,
  })

  export type CheckoutResidual = z.infer<typeof CheckoutResidual>
  export type StaysSelected = z.infer<typeof StaysSelected>
  export type StaysMerged = z.infer<typeof StaysMerged>
  export type MergesFailed = z.infer<typeof MergesFailed>
  export type Paid = z.infer<typeof Paid>
  export type Confirmed = z.infer<typeof Confirmed>

  export const Event = variantModule({
    StaysSelected: data<StaysSelected>(),
    StaysMerged: data<StaysMerged>(),
    MergesFailed: data<MergesFailed>(),
    Paid: data<Paid>(),
    Confirmed: data<Confirmed>(),
  })
  export type Event = VariantOf<typeof Event>

  export const codec = Codec.upcast<Event>(
    Codec.json(),
    Codec.Upcast.body({
      StaysSelected: StaysSelected.parse,
      StaysMerged: StaysMerged.parse,
      MergesFailed: MergesFailed.parse,
      Paid: Paid.parse,
      Confirmed: Confirmed.parse,
    }),
  )
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

  function removePending(xs: GuestStayId[], state: State) {
    return { ...state, pending: state.pending.filter((id) => !xs.includes(id)) }
  }

  export function evolve(state: State, event: Events.Event): State {
    switch (event.type) {
      case "StaysSelected":
        return { ...state, pending: state.pending.concat(event.data.stays) }
      case "StaysMerged":
        return {
          ...removePending(
            event.data.residuals.map((x) => x.stay),
            state,
          ),
          checkedOut: state.checkedOut.concat(event.data.residuals),
          balance: state.balance + sumBy(event.data.residuals, (x) => x.residual),
        }
      case "MergesFailed":
        return { ...state, failed: state.failed.concat(event.data.stays) }
      case "Paid":
        return {
          ...state,
          balance: state.balance - event.data.amount,
          payments: state.payments.concat([event.data.paymentId]),
        }
      case "Confirmed":
        return { ...state, completed: true }
    }
  }

  export const fold = reduce(evolve)
}

export namespace Flow {
  export const State = variantModule({
    MergeStays: fields<{ stays: GuestStayId[] }>(),
    Ready: fields<{ balance: number }>(),
    Finished: {},
  })
  export type State = VariantOf<typeof State>

  export const nextAction = (state: Fold.State): State => {
    if (state.completed) return State.Finished()
    if (state.pending.length > 0) return State.MergeStays({ stays: state.pending })
    return State.Ready({ balance: state.balance })
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
      return [Events.Event.StaysSelected({ stays, at })]
    }

  const ConfirmResult = variantModule({
    Processing: {},
    Ok: {},
    BalanceOustanding: fields<{ balance: number }>(),
  })
  type ConfirmResult = VariantOf<typeof ConfirmResult>

  export const confirm =
    (at: OffsetDateTime): DecisionResult<ConfirmResult> =>
    (state) => {
      const action = Flow.nextAction(state)
      switch (action.type) {
        case "Finished":
          return [ConfirmResult.Ok(), []]
        case "Ready":
          if (state.balance === 0) return [ConfirmResult.Ok(), [Events.Event.Confirmed({ at })]]
          return [ConfirmResult.BalanceOustanding({ balance: state.balance }), []]
        case "MergeStays":
          return [ConfirmResult.Processing(), []]
      }
    }

  export const pay =
    (paymentId: PaymentId, at: OffsetDateTime, amount: number): Decision =>
    (state) => {
      if (state.payments.includes(paymentId)) return []
      return [Events.Event.Paid({ paymentId, at, amount })]
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
