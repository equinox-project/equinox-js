import { Invoice, InvoiceAutoEmailer, Payer } from "./domain/index.js"

export const categories = [
  { name: Invoice.Stream.category, codec: Invoice.Events.codec, fold: Invoice.Fold },
  { name: Payer.Stream.category, codec: Payer.Events.codec, fold: Payer.Fold },
  {
    name: InvoiceAutoEmailer.Stream.category,
    codec: InvoiceAutoEmailer.Events.codec,
    fold: InvoiceAutoEmailer.Fold,
  },
]
