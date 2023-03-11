type Branded<T extends string> = string & { __brand: T }
export type GuestStayId = Branded<"GuestStayId">
export type ChargeId = Branded<"ChargeId">
export type PaymentId = Branded<"PaymentId">
