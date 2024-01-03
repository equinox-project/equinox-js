import { Uuid } from "@equinox-js/core"

export type GuestStayId = Uuid.Uuid<"GuestStayId">
export const GuestStayId = Uuid.create<"GuestStayId">()
export type PaymentId = Uuid.Uuid<"PaymentId">
export const PaymentId = Uuid.create<"PaymentId">()
export type PayerId = Uuid.Uuid<"PayerId">
export const PayerId = Uuid.create<"PayerId">()
export type InvoiceId = Uuid.Uuid<"InvoiceId">
export const InvoiceId = Uuid.create<"InvoiceId">()
export type ChargeId = Uuid.Uuid<"ChargeId">
export const ChargeId = Uuid.create<"ChargeId">()
