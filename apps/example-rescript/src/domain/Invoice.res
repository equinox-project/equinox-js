open Belt
open Equinox
open Identifiers

module Stream = {
  let category = "Invoice"
  let streamId = StreamId.gen(InvoiceId.toString)
  let decodeId = StreamId.dec(InvoiceId.parse)
  let tryMatch = StreamName.tryMatch(category, decodeId)
}

module Event = {
  @decco
  type invoice_raised = {payer_id: PayerId.t, amount: float, due_date: Date.t}
  type payment_received = {reference: string, amount: float}
  type t =
    | InvoiceRaised(invoice_raised)
    | PaymentReceived(payment_received)
    | InvoiceFinalized

  let encode = (x, ()) =>
    switch x {
    | InvoiceRaised(x) => ("InvoiceRaised", Js.Json.stringifyAny(x))
    | PaymentReceived(x) => ("PaymentReceived", Js.Json.stringifyAny(x))
    | InvoiceFinalized => ("InvoiceFinalized", None)
    }
  let parseDate = x => {
    x["due_date"] = Js.Date.fromString(x["due_date"])
    x
  }
  let tryDecode = x =>
    switch x {
    | ("InvoiceRaised", Some(x)) =>
      InvoiceRaised(Js.Json.parseExn(x)->Obj.magic->parseDate->Obj.magic)->Some
    | ("PaymentReceived", Some(x)) => PaymentReceived(Js.Json.parseExn(x)->Obj.magic)->Some
    | ("InvoiceFinalized", None) => InvoiceFinalized->Some
    | _ => None
    }

  let codec = Codec.json(encode, tryDecode)
}

module Fold = {
  open Event
  type invoice_state = {
    amount: float,
    payer_id: PayerId.t,
    payments: Set.String.t,
    amount_paid: float,
  }
  type state = Initial | Raised(invoice_state) | Finalized(invoice_state)
  let initial = Initial
  let evolveInitial = event =>
    switch event {
    | InvoiceRaised({payer_id, amount}) =>
      Raised({amount, payer_id, payments: Set.String.empty, amount_paid: 0.})
    | _ => failwith("Unexpected event")
    }

  let evolveRaised = (state, event) =>
    switch event {
    | InvoiceRaised(_) => failwith("Unexpected event")
    | PaymentReceived({reference, amount}) =>
      Raised({
        ...state,
        payments: state.payments->Set.String.add(reference),
        amount_paid: state.amount_paid +. amount,
      })
    | InvoiceFinalized => Finalized(state)
    }
  let evolveFinalized = _event => failwith("Unexpected event")

  let evolve = (state, event) => {
    switch state {
    | Initial => evolveInitial(event)
    | Raised(state) => evolveRaised(state, event)
    | Finalized(_) => evolveFinalized(event)
    }
  }

  let fold = (state, events) => events->Array.reduce(state, evolve)
}

module Decide = {
  open Event
  let raiseInvoice = data => state =>
    switch state {
    | Fold.Initial => [Event.InvoiceRaised(data)]
    | Raised(state) =>
      if state.amount == data.amount && state.payer_id == data.payer_id {
        []
      } else {
        failwith("Invoice is already raised")
      }
    | Finalized(_) => failwith("invoice is finalized")
    }

  let recordPayment = data => state =>
    switch state {
    | Fold.Initial => failwith("Invoice not found")
    | Finalized(_) => failwith("Invoice is finalized")
    | Raised(state) if state.payments->Set.String.has(data.reference) => []
    | Raised(_) => [Event.PaymentReceived(data)]
    }
  let finalize = state =>
    switch state {
    | Fold.Initial => failwith("Invoice not found")
    | Finalized(_) => []
    | Raised(_) => [Event.InvoiceFinalized]
    }
}

module Query = {
  type model = {
    amount: float,
    payer_id: string,
    finalized: bool,
  }
  let isFinalized = state =>
    switch state {
    | Fold.Finalized(_) => true
    | _ => false
    }
  let summary = state => {
    let finalized = isFinalized(state)
    switch state {
    | Fold.Initial => None
    | Raised(state) | Finalized(state) =>
      Some({
        amount: state.amount,
        payer_id: PayerId.toString(state.payer_id),
        finalized,
      })
    }
  }
}

module Service = {
  type t = {resolve: InvoiceId.t => Decider.t<Event.t, Fold.state>}

  let raise = (service, id, data) => {
    let decider = service.resolve(id)
    decider->Decider.transact(Decide.raiseInvoice(data))
  }

  let recordPayment = (service, id, data) => {
    let decider = service.resolve(id)
    decider->Decider.transact(Decide.recordPayment(data))
  }

  let finalize = (service, id) => {
    let decider = service.resolve(id)
    decider->Decider.transact(Decide.finalize)
  }

  let readInvoice = (service, id) => {
    let decider = service.resolve(id)
    decider->Decider.query(Query.summary)
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
      MessageDb.AccessStrategy.unoptimized(),
    )

  let create = config => {
    let category = resolveCategory(config)
    let resolve = id => Decider.forStream(category, Stream.streamId(id))
    {Service.resolve: resolve}
  }
}
