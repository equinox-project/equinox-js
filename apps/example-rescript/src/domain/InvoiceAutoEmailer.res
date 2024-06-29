open Equinox
open Identifiers

module Stream = {
  let category = "InvoiceAutoEmail"
  let streamId = StreamId.gen(InvoiceId.toString)
}

module Event = {
  type email_sent = {email: string, payer_id: PayerId.t}
  type email_sending_failed = {payer_id: PayerId.t, reason: string}
  type t =
    | EmailSent(email_sent)
    | EmailSendingFailed(email_sending_failed)

  let encode = (x, ()) =>
    switch x {
    | EmailSent(x) => ("EmailSent", Js.Json.stringifyAny(x))
    | EmailSendingFailed(x) => ("EmailSendingFailed", Js.Json.stringifyAny(x))
    }
  let tryDecode = x =>
    switch x {
    | ("EmailSent", Some(x)) => EmailSent(Js.Json.parseExn(x)->Obj.magic)->Some
    | ("EmailSendingFailed", Some(x)) => EmailSendingFailed(Js.Json.parseExn(x)->Obj.magic)->Some
    | _ => None
    }

  let codec = Codec.json(encode, tryDecode)
}

module Fold = {
  type state = option<Event.t>
  let initial = None
  let evolve = (_state: state, event): state => Some(event)
  let fold = (state, events) => events->Belt.Array.reduce(state, evolve)
}

module Service = {
  type send_email = (string, string, string) => promise<unit>
  type t = {
    payerService: Payer.Service.t,
    sendMail: send_email,
    resolve: InvoiceId.t => Decider.t<Event.t, Fold.state>,
  }

  let sendEmail = (service, invoiceId, payerId, amount) => {
    let decider = service.resolve(invoiceId)
    decider->Decider.transactAsync(async state => {
      switch state {
      | Some(_) => []
      | None => {
          let payer = await Payer.Service.readProfile(service.payerService, payerId)
          switch payer {
          | None => [Event.EmailSendingFailed({payer_id: payerId, reason: "Payer not found"})]
          | Some(payer) =>
            try {
              await service.sendMail(
                payer.email,
                "Invoice",
                "Please pay " ++ Js.Float.toString(amount) ++ " by tuesday",
              )
              [Event.EmailSent({email: payer.email, payer_id: payerId})]
            } catch {
            | Js.Exn.Error(err) => [
                Event.EmailSendingFailed({
                  reason: Js.Exn.message(err)->Belt.Option.getWithDefault("unknown error"),
                  payer_id: payerId,
                }),
              ]
            }
          }
        }
      }
    })
  }

  let inspectState = (service, invoiceId) => {
    let decider = service.resolve(invoiceId)
    decider->Decider.query(s => s)
  }
}

@warning("-44")
module Config = {
  let resolveCategory = ((context, cache)) =>
    context->MessageDb.Category.create(
      Stream.category,
      Event.codec,
      Fold.fold,
      Fold.initial,
      CachingStrategy.cached(cache),
      MessageDb.AccessStrategy.latestKnownEvent(),
    )

  let create = (config, sendEmail) => {
    let payerService = Payer.Config.create(config)
    let sendMail = switch sendEmail {
    | None => EmailSender.Memory.sendEmail
    | Some(sendEmail) => sendEmail
    }
    let category = resolveCategory(config)
    let resolve = (id: InvoiceId.t) => Decider.forStream(category, Stream.streamId(id))
    {Service.payerService, sendMail, resolve}
  }

  let decodeFirstEvent = (stream, events) => {
    switch Invoice.Stream.tryMatch(stream) {
    | None => None
    | Some(id) =>
      switch Invoice.Event.codec.tryDecode(events[0]) {
      | Some(event) => Some((id, event))
      | _ => None
      }
    }
  }

  let createHandler = (config, sendEmail) => {
    let service = create(config, sendEmail)
    async (stream, events) => {
      switch decodeFirstEvent(stream, events) {
      | Some(id, Invoice.Event.InvoiceRaised({payer_id, amount})) =>
        await service->Service.sendEmail(id, payer_id, amount)
      | _ => ()
      }
    }
  }
}
