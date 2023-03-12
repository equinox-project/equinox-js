type Branded<T extends string> = string & { __brand: T }
export type GuestStayId = Branded<"GuestStayId">
export type ChargeId = Branded<"ChargeId">
export type PaymentId = Branded<"PaymentId">
export type PayerId = Branded<"PayerId">
export type InvoiceId = Branded<"InvoiceId">
