# Invoice

Based on the blog post on [The Equinox Programming Model](https://nordfjord.io/2022/12/05/equinox.html)

```ts
import { PayerId } from "./types"
import z from 'zod'

type InvoiceRaised = { invoice_number: number; payer_id: PayerId; amount: number }
type Payment = { amount: number }
type EmailReceipt = { idempotency_key: string; recipient: string; sent_at: Date }

type Event =
  | { type: "InvoiceRaised", data: InvoiceRaised }
  | { type: "InvoiceEmailed", data: EmailReceipt }
  | { type: "PaymentReceived", data: Payment }
  | { type: "InvoiceFinalized" }

const codec = {
  tryDecode(ev) {
    switch (ev.type) {}
  }
}
```