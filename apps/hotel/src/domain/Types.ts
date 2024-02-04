import { Uuid } from "@equinox-js/core"

export type GroupCheckoutId = Uuid.Uuid<"GroupCheckoutId">
export const GroupCheckoutId = Uuid.create<"GroupCheckoutId">()

export type GuestStayId = Uuid.Uuid<"GuestStayId">
export const GuestStayId = Uuid.create<"GuestStayId">()

export type ChargeId = Uuid.Uuid<"ChargeId">
export const ChargeId = Uuid.create<"ChargeId">()

export type PaymentId = Uuid.Uuid<"PaymentId">
export const PaymentId = Uuid.create<"PaymentId">()

export const data =
  <T>() =>
  (data: T) => ({ data })
