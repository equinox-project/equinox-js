import { randomUUID } from "crypto"
import { z } from "zod"

type BrandedUUID<T extends PropertyKey> = z.ZodUUID & {
  _zod: { output: string & z.core.$brand<T> }
} & { create: () => string & z.core.$brand<T> }

function make<T extends PropertyKey>(): BrandedUUID<T> {
  const uuid = z.uuid().brand<T>()
  return Object.assign(uuid, {
    create: () => uuid.parse(randomUUID()),
  }) as BrandedUUID<T>
}

export const PayerId = make<"PayerId">()
export type PayerId = z.infer<typeof PayerId>

export const InvoiceId = make<"InvoiceId">()
export type InvoiceId = z.infer<typeof InvoiceId>
