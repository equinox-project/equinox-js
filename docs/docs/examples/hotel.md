# Hotel

```ts
import { ChargeId, GuestStayId, PaymentId } from "./types"
import { Decider, ICachingStrategy, ICodec, StreamId } from "@equinox-js/core"
import * as Mdb from "@equinox-js/message-db"
import * as Mem from "@equinox-js/memory-store"

export const Category = "GuestStay"

const streamId = StreamId.gen(GuestStayId.toString)

type Event =
  /** Notes time of checkin of the guest (does not affect whether charges can be levied against the stay) */
  | { type: "CheckedIn"; data: { at: Date } }
  /** Notes addition of a charge against the stay */
  | { type: "Charged"; data: { chargeId: ChargeId; at: Date; amount: number } }
  /** Notes a payment against this stay */
  | { type: "Paid"; data: { paymentId: PaymentId; at: Date; amount: number } }
  /** Notes an ordinary checkout by the Guest (requires prior payment of all outstanding charges) */
  | { type: "CheckedOut"; data: { at: Date } }

const codec: ICodec<Event, string> = {
  tryDecode(ev): Event | undefined {
    const data = JSON.parse(ev.data || "{}")
    switch (ev.type) {
      case "CheckedIn":
        return { type: ev.type, data: { at: new Date(data.at) } }
      case "CheckedOut":
        return { type: ev.type, data: { at: new Date(data.at) } }
      case "Charged":
        return {
          type: ev.type,
          data: { chargeId: data.chargeId, amount: data.amount, at: new Date(data.at) },
        }
      case "Paid":
        return {
          type: ev.type,
          data: { paymentId: data.paymentId, amount: data.amount, at: new Date(data.at) },
        }
    }
  },
  encode(ev) {
    return { type: ev.type, data: JSON.stringify(ev.data) }
  },
}

type Balance = {
  balance: number
  charges: Set<ChargeId>
  payments: Set<PaymentId>
  checkedInAt?: Date
}
type State = { type: "Active"; balance: Balance } | { type: "Closed" }
const initial: State = {
  type: "Active",
  balance: { balance: 0, charges: new Set(), payments: new Set() },
}

function evolve(state: State, event: Event): State {
  switch (state.type) {
    case "Active":
      switch (event.type) {
        case "CheckedIn":
          return { type: "Active", balance: { ...state.balance, checkedInAt: event.data.at } }
        case "Charged":
          return {
            type: "Active",
            balance: {
              ...state.balance,
              charges: new Set([...state.balance.charges, event.data.chargeId]),
              balance: state.balance.balance + event.data.amount,
            },
          }
        case "Paid":
          return {
            type: "Active",
            balance: {
              ...state.balance,
              payments: new Set([...state.balance.payments, event.data.paymentId]),
              balance: state.balance.balance - event.data.amount,
            },
          }
        case "CheckedOut":
          return { type: "Closed" }
      }
      break
    case "Closed":
      throw new Error("No events allowed after CheckedOut")
  }
}

const fold = (state: State, events: Event[]) => events.reduce(evolve, state)

const checkIn =
  (at: Date) =>
  (state: State): Event[] => {
    if (state.type === "Closed") throw new Error("Invalid checkin")
    if (!state.balance.checkedInAt) return [{ type: "CheckedIn", data: { at } }]
    if (+state.balance.checkedInAt === +at) return []
    throw new Error("Invalid checkin")
  }

const charge =
  (at: Date, chargeId: ChargeId, amount: number) =>
  (state: State): Event[] => {
    if (state.type === "Closed") throw new Error("Cannot record charge for Closed account")
    if (state.balance.charges.has(chargeId)) return []
    return [{ type: "Charged", data: { chargeId, amount, at } }]
  }

const pay =
  (at: Date, paymentId: PaymentId, amount: number) =>
  (state: State): Event[] => {
    if (state.type === "Closed") throw new Error("Cannot record payment for not opened account")
    if (state.balance.payments.has(paymentId)) return []
    return [{ type: "Paid", data: { paymentId, amount, at } }]
  }

type CheckoutResult =
  | { type: "OK" }
  | { type: "AlreadyCheckedOut" }
  | { type: "BalanceOutstanding"; amount: number }
const checkOut =
  (at: Date) =>
  (state: State): [CheckoutResult, Event[]] => {
    if (state.type === "Closed") return [{ type: "AlreadyCheckedOut" }, []]
    if (state.balance.balance > 0)
      return [{ type: "BalanceOutstanding", amount: state.balance.balance }, []]
    return [{ type: "OK" }, [{ type: "CheckedOut", data: { at } }]]
  }

export class Service {
  constructor(private readonly resolve: (stayId: GuestStayId) => Decider<Event, State>) {}
  charge(stayId: GuestStayId, chargeId: ChargeId, amount: number) {
    const decider = this.resolve(stayId)
    return decider.transact(charge(new Date(), chargeId, amount))
  }

  pay(stayId: GuestStayId, paymentId: PaymentId, amount: number) {
    const decider = this.resolve(stayId)
    return decider.transact(pay(new Date(), paymentId, amount))
  }

  checkIn(stayId: GuestStayId) {
    const decider = this.resolve(stayId)
    return decider.transact(checkIn(new Date()))
  }

  checkOut(stayId: GuestStayId) {
    const decider = this.resolve(stayId)
    return decider.transactResult(checkOut(new Date()))
  }

  static createMessageDb(context: Mdb.MessageDbContext, caching: ICachingStrategy) {
    const category = Mdb.MessageDbCategory.create(context, Category, codec, fold, initial, caching)
    const resolve = (stayId: GuestStayId) =>
      Decider.forStream(category, streamId(stayId), null)
    return new Service(resolve)
  }

  static createMem(store: Mem.VolatileStore<string>) {
    const category = Mem.MemoryStoreCategory.create(store, Category, codec, fold, initial)
    const resolve = (stayId: GuestStayId) =>
      Decider.forStream(category, streamId(stayId), null)
    return new Service(resolve)
  }
}
```

Note: this example is using branded strings for identifiers. the `./types.ts` file might look like:

```ts
type Branded<T extends string> = string & { __brand: T }
export type GuestStayId = Branded<"GuestStayId">
export type ChargeId = Branded<"ChargeId">
export type PaymentId = Branded<"PaymentId">
```

This is quite a handy trick as it can prevent a whole class of errors from ever appearing.
