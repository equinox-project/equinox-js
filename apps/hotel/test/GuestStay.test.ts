import { test, expect } from "vitest"
import { OffsetDateTime } from "@js-joda/core"
import { Events, Fold, Decide } from "../src/domain/GuestStay.js"
import { ChargeId, GroupCheckoutId, PaymentId } from "../src/domain/Types.js"

type Decision<T> = (state: Fold.State) => T

const given = <T>(events: Events.Event[], decide: Decision<T>) => {
  const state = Fold.fold(Fold.initial, events)
  return decide(state)
}

const now = OffsetDateTime.now()
const later = now.plusDays(1)

test("checkin", () =>
  expect(given([], Decide.checkIn(now))).toEqual([Events.CheckedIn({ at: now })]))

test("checkin twice", () =>
  expect(given([Events.CheckedIn({ at: now })], Decide.checkIn(later))).toEqual([]))

test("charge", () => {
  const chargeId = ChargeId.create()
  const charge = Decide.charge(now, chargeId, 100)
  expect(given([], charge)).toEqual([Events.Charged({ chargeId, at: now, amount: 100 })])
})

test("charge twice", () => {
  const chargeId = ChargeId.create()
  const charge = Decide.charge(now, chargeId, 100)
  expect(given([Events.Charged({ chargeId, at: now, amount: 100 })], charge)).toEqual([])
})

test("checkout", () =>
  expect(given([], Decide.checkOut(now))).toEqual([
    { type: "Ok" },
    [Events.CheckedOut({ at: now })],
  ]))

test("checkout twice", () =>
  expect(given([Events.CheckedOut({ at: now })], Decide.checkOut(later))).toEqual([
    { type: "Ok" },
    [],
  ]))

test("checkout with balance", () => {
  const chargeId = ChargeId.create()
  const charge = Events.Charged({ chargeId, at: now, amount: 100 })
  expect(given([charge], Decide.checkOut(now))).toEqual([
    { type: "BalanceOutstanding", balance: 100 },
    [],
  ])
})

test("transfer", () => {
  const groupId = GroupCheckoutId.create()
  expect(given([], Decide.groupCheckout(now, groupId))).toEqual([
    { type: "Ok", residualBalance: 0 },
    [Events.TransferredToGroup({ at: now, groupId, residualBalance: 0 })],
  ])
})

test("transfer with balance", () => {
  const groupId = GroupCheckoutId.create()
  const chargeId = ChargeId.create()
  const charged = Events.Charged({ chargeId, at: now, amount: 100 })
  expect(given([charged], Decide.groupCheckout(now, groupId))).toEqual([
    { type: "Ok", residualBalance: 100 },
    [Events.TransferredToGroup({ at: now, groupId, residualBalance: 100 })],
  ])
})

test("transfer after checkout", () => {
  const groupId = GroupCheckoutId.create()
  const checkout = Events.CheckedOut({ at: now })
  expect(given([checkout], Decide.groupCheckout(now, groupId))).toEqual([
    { type: "AlreadyCheckedOut" },
    [],
  ])
})

test("transfer after transfer", () => {
  const groupId = GroupCheckoutId.create()
  const groupId2 = GroupCheckoutId.create()
  const transfer = Events.TransferredToGroup({ at: now, groupId, residualBalance: 100 })
  expect(given([transfer], Decide.groupCheckout(now, groupId2))).toEqual([
    { type: "AlreadyCheckedOut" },
    [],
  ])
})

test("transfer to same group", () => {
  const groupId = GroupCheckoutId.create()
  const transfer = Events.TransferredToGroup({ at: now, groupId, residualBalance: 100 })
  expect(given([transfer], Decide.groupCheckout(now, groupId))).toEqual([
    { type: "Ok", residualBalance: 100 },
    [],
  ])
})

test("checkout after transfer", () => {
  const groupId = GroupCheckoutId.create()
  const transfer = Events.TransferredToGroup({ at: now, groupId, residualBalance: 100 })
  expect(given([transfer], Decide.checkOut(now))).toEqual([{ type: "AlreadyCheckedOut" }, []])
})

test("pay", () => {
  const paymentId = PaymentId.create()
  expect(given([], Decide.payment(now, paymentId, 100))).toEqual([
    Events.Paid({ paymentId, at: now, amount: 100 }),
  ])
})

test("pay twice", () => {
  const paymentId = PaymentId.create()
  const paid = Events.Paid({ paymentId, at: now, amount: 100 })
  expect(given([paid], Decide.payment(now, paymentId, 100))).toEqual([])
})
