import EventEmitter from "events"
import { Async, CancellationToken, Continuation } from "./Async"

type MailboxBody<Msg> = (mb: MailboxProcessor<Msg>) => Async<void>

class QueueCell<Msg> {
  public value: Msg
  public next?: QueueCell<Msg>

  constructor(message: Msg) {
    this.value = message
  }
}

class MailboxQueue<Msg> {
  private firstAndLast?: [QueueCell<Msg>, QueueCell<Msg>]
  public size = 0

  public add(message: Msg) {
    const itCell = new QueueCell(message)
    if (this.firstAndLast) {
      this.firstAndLast[1].next = itCell
      this.firstAndLast = [this.firstAndLast[0], itCell]
    } else {
      this.firstAndLast = [itCell, itCell]
    }
    this.size++
  }

  public tryGet() {
    if (this.firstAndLast) {
      const value = this.firstAndLast[0].value
      if (this.firstAndLast[0].next) {
        this.firstAndLast = [this.firstAndLast[0].next, this.firstAndLast[1]]
      } else {
        delete this.firstAndLast
      }
      this.size--
      return value
    }
    return void 0
  }
}

export interface AsyncReplyChannel<Reply> {
  reply: (msg: Reply) => void
}

export class MailboxProcessor<Msg> {
  public body: MailboxBody<Msg>
  public messages: MailboxQueue<Msg>
  public cancelToken: CancellationToken
  public continuation?: Continuation<Msg>
  public events = new EventEmitter()
  public started = false

  constructor(body: MailboxBody<Msg>, cancelToken: CancellationToken) {
    this.body = body
    this.cancelToken = cancelToken
    this.messages = new MailboxQueue()
  }

  #processEvents() {
    if (this.continuation) {
      const msg = this.messages.tryGet()
      if (msg) {
        const cont = this.continuation
        delete this.continuation
        cont(msg)
      }
    }
  }

  post(message: Msg) {
    this.messages.add(message)
    this.#processEvents()
  }

  receive() {
    return Async.fromContinuations<Msg>((cont) => {
      if (this.continuation) throw new Error("Receive called twice")
      this.continuation = cont.resolve
      this.#processEvents()
    })
  }

  postAndAsyncReply<Reply>(buildMessage: (c: AsyncReplyChannel<Reply>) => Msg) {
    return new Promise<Reply>((resolve) => {
      this.post(buildMessage({ reply: resolve }))
    })
  }

  private prepareToStart() {
    if (this.started) throw new Error("MailboxProcessor already started")
    this.started = true
    return this.body(this).catch((err) => {
      this.events.emit("error", err)
      return Async.of(undefined)
    })
  }

  start() {
    const computation = this.prepareToStart()
    return Async.start(computation, this.cancelToken)
  }

  static start<Msg>(body: MailboxBody<Msg>, cancelToken: CancellationToken) {
    const mb = new MailboxProcessor(body, cancelToken)
    mb.start()
    return mb
  }
}
