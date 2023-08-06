import { Codec, Decider, ITimelineEvent, StreamId } from "@equinox-js/core"
import { InvoiceId, PayerId } from "./identifiers.js"
import * as Payer from "./payer.js"
import { EmailSender, ISendEmails } from "./send-email.js"
import * as Config from "../config/equinox.js"
import * as Invoice from "./invoice.js"
import { s } from "@equinox-js/schema"

const CATEGORY = "InvoiceAutoEmail"
const streamId = StreamId.gen(InvoiceId.toString)

const EmailSent = s.schema({
  email: s.regex(/^.+@.+$/),
  payer_id: s.map(s.string, PayerId.parse, PayerId.toString),
})
type EmailSent = s.infer<typeof EmailSent>
const EmailSendingFailed = s.schema({
  payer_id: s.map(s.string, PayerId.parse, PayerId.toString),
  reason: s.string,
})
type EmailSendingFailed = s.infer<typeof EmailSendingFailed>

const Event = s.variant({
  EmailSent,
  EmailSendingFailed,
})

export type Event = s.infer<typeof Event>
export const codec = Codec.ofSchema(Event)

export type State = null | Event
const initial: State = null
export const fold = (state: State, events: Event[]) =>
  events.length ? events[events.length - 1] : state

export class Service {
  constructor(
    private readonly payerService: Payer.Service,
    private readonly mailer: ISendEmails,
    private readonly resolve: (id: InvoiceId) => Decider<Event, State>,
  ) {}

  sendEmail(invoiceId: InvoiceId, payerId: PayerId, amount: number) {
    const decider = this.resolve(invoiceId)
    return decider.transactAsync(async (state) => {
      if (state?.type === "EmailSent") return []
      const payer = await this.payerService.readProfile(payerId)
      if (!payer)
        return [Event.EmailSendingFailed({ payer_id: payerId, reason: "Payer not found" })]
      try {
        await this.mailer.sendEmail(
          payer.email,
          `Invoice for ${amount}`,
          `Please pay ${amount} by tuesday`,
        )
        return [Event.EmailSent({ email: payer.email, payer_id: payerId })]
      } catch (err: any) {
        return [
          Event.EmailSendingFailed({
            payer_id: payerId,
            reason: err?.message ?? "Unknown failure",
          }),
        ]
      }
    })
  }

  /** Not to be used except in tests */
  inspectState(invoiceId: InvoiceId) {
    const decider = this.resolve(invoiceId)
    return decider.query((s) => s)
  }

  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory:
        return Config.MemoryStore.create(CATEGORY, codec, fold, initial, config)
      case Config.Store.MessageDb:
        return Config.MessageDb.createLatestKnown(CATEGORY, codec, fold, initial, config)
    }
  }

  static create(config: Config.Config, emailSender?: ISendEmails) {
    const payerService = Payer.Service.create(config)
    // could inject this via an argument too
    const emailer = emailSender ?? new EmailSender()
    const category = Service.resolveCategory(config)
    const resolve = (id: InvoiceId) => Decider.forStream(category, streamId(id), null)
    return new Service(payerService, emailer, resolve)
  }
}

export const createHandler = (config: Config.Config, emailSender?: ISendEmails) => {
  const service = Service.create(config, emailSender)
  return async (stream: string, events: ITimelineEvent[]) => {
    const id = Invoice.Stream.tryMatch(stream)
    if (!id) return
    const ev = Invoice.Events.codec.tryDecode(events[0])
    if (ev?.type !== "InvoiceRaised") return
    await service.sendEmail(id, ev.data.payer_id, ev.data.amount)
  }
}
