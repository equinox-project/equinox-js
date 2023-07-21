import { Uuid } from "@equinox-js/core"

export type PayerId = Uuid.Uuid<"PayerId">
export const PayerId = Uuid.create<"PayerId">()

export type InvoiceId = Uuid.Uuid<"InvoiceId">
export const InvoiceId = Uuid.create<"InvoiceId">()
