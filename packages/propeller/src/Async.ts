export class OperationCancelledError extends Error {
  constructor() {
    super("The operation was cancelled")
  }
}

export type Continuation<T> = (value: T) => void

export class Continuations<T> {
  constructor(
    public resolve: Continuation<T>,
    public reject: Continuation<Error>,
    public cancel: Continuation<OperationCancelledError>,
  ) {}
}

export class CancellationToken {
  private _id: number
  private _cancelled = false
  private _listeners: Map<number, () => void>
  constructor(cancelled = false) {
    this._id = 0
    this._cancelled = cancelled
    this._listeners = new Map()
  }

  get isCancelled() {
    return this._cancelled
  }

  cancel() {
    if (this._cancelled) return
    this._cancelled = true
    for (const l of this._listeners.values()) l()
  }

  addListener(listener: () => void) {
    const id = this._id
    this._listeners.set(this._id++, listener)
    return id
  }

  removeListener(id: number) {
    this._listeners.delete(id)
  }

  throwIfCancelled() {
    if (this._cancelled) throw new OperationCancelledError()
  }

  static ofAbortSignal(signal: AbortSignal) {
    const token = new CancellationToken(signal.aborted)
    if (!signal.aborted) {
      const cancel = () => token.cancel()
      signal.addEventListener("abort", cancel)
      token.addListener(() => signal.removeEventListener("abort", cancel))
    }
    return token
  }
}

export class Trampoline {
  static maxTrampolineDepth = 2000
  private callCount = 0
  constructor() {
    this.callCount = 0
  }

  incrementAndCheck() {
    return this.callCount++ > Trampoline.maxTrampolineDepth
  }

  hijack(f: () => void) {
    this.callCount = 0
    setTimeout(f, 0)
  }
}

export interface IAsyncContext<T> {
  onSuccess: Continuation<T>
  onError: Continuation<Error>
  onCancel: Continuation<OperationCancelledError>

  cancelToken: CancellationToken
  trampoline: Trampoline
}

export type IAsync<T> = (ctx: IAsyncContext<T>) => void

function protectedCont<T>(f: IAsync<T>) {
  return (ctx: IAsyncContext<T>) => {
    if (ctx.cancelToken.isCancelled) {
      ctx.onCancel(new OperationCancelledError())
      return
    }
    if (ctx.trampoline.incrementAndCheck()) {
      ctx.trampoline.hijack(() => {
        try {
          f(ctx)
        } catch (e: any) {
          ctx.onError(e)
        }
      })
      return
    }
    try {
      f(ctx)
    } catch (e: any) {
      ctx.onError(e)
    }
  }
}

function emptyCont<T>(_: T) {}

export class Async<T> {
  #computation: IAsync<T>
  constructor(computation: IAsync<T>) {
    this.#computation = computation
  }

  chain<V>(f: (value: T) => Async<V>): Async<V> {
    return new Async(
      protectedCont((ctx) =>
        this.#computation({
          onSuccess: (value) => {
            try {
              f(value).#computation(ctx)
            } catch (e: any) {
              ctx.onError(e)
            }
          },
          onError: ctx.onError,
          onCancel: ctx.onCancel,
          cancelToken: ctx.cancelToken,
          trampoline: ctx.trampoline,
        }),
      ),
    )
  }

  map<V>(f: (value: T) => V) {
    return new Async(
      protectedCont((ctx) =>
        this.#computation({
          onSuccess: (value) => ctx.onSuccess(f(value)),
          onError: ctx.onError,
          onCancel: ctx.onCancel,
          cancelToken: ctx.cancelToken,
          trampoline: ctx.trampoline,
        }),
      ),
    )
  }

  catch(f: (err: Error) => Async<T>) {
    return new Async<T>(
      protectedCont((ctx) =>
        this.#computation({
          onSuccess: ctx.onSuccess,
          onError: (err) => {
            try {
              f(err).#computation(ctx)
            } catch (e: any) {
              ctx.onError(e)
            }
          },
          onCancel: ctx.onCancel,
          cancelToken: ctx.cancelToken,
          trampoline: ctx.trampoline,
        }),
      ),
    )
  }

  finally(compensate: () => void) {
    return new Async(
      protectedCont((ctx) =>
        this.#computation({
          onSuccess: (value) => {
            compensate()
            ctx.onSuccess(value)
          },
          onError: (err) => {
            compensate()
            ctx.onError(err)
          },
          onCancel: (err) => {
            compensate()
            ctx.onCancel(err)
          },
          cancelToken: ctx.cancelToken,
          trampoline: ctx.trampoline,
        }),
      ),
    )
  }

  static delay<T>(gen: () => Async<T>) {
    return new Async(protectedCont((ctx) => gen().#computation(ctx)))
  }

  static sleep(ms: number) {
    return protectedCont((ctx: IAsyncContext<void>) => {
      let tokenId: number
      const timeoutId = setTimeout(() => {
        ctx.cancelToken.removeListener(tokenId)
        ctx.onSuccess(void 0)
      }, ms)
      tokenId = ctx.cancelToken.addListener(() => {
        clearTimeout(timeoutId)
        ctx.onCancel(new OperationCancelledError())
      })
    })
  }

  static startWithContinuations<T>(
    computation: Async<T>,
    continuation?: Continuation<T>,
    errorContinuation?: Continuation<Error>,
    cancelContinuation?: Continuation<OperationCancelledError>,
    cancelToken?: CancellationToken,
  ) {
    const trampoline = new Trampoline()
    cancelToken ??= new CancellationToken()
    computation.#computation({
      onSuccess: continuation ?? emptyCont,
      onError: errorContinuation ?? emptyCont,
      onCancel: cancelContinuation ?? emptyCont,
      cancelToken,
      trampoline,
    })
  }

  static fromContinuations<T>(fn: (conts: Continuations<T>) => void) {
    return new Async<T>(
      protectedCont((ctx) => fn(new Continuations(ctx.onSuccess, ctx.onError, ctx.onCancel))),
    )
  }

  static start<T>(computation: Async<T>, cancelToken?: CancellationToken) {
    return Async.startWithContinuations(computation, undefined, undefined, undefined, cancelToken)
  }

  static startAsPromise<T>(computation: Async<T>, cancelToken: CancellationToken) {
    return new Promise<T>((resolve, reject) => {
      Async.startWithContinuations(computation, resolve, reject, reject, cancelToken)
    })
  }

  static awaitPromise<T>(promise: Promise<T>) {
    return Async.fromContinuations<T>((conts) =>
      promise.then(conts.resolve).catch((err) => {
        if (err instanceof OperationCancelledError) conts.cancel(err)
        else conts.reject(err)
      }),
    )
  }

  static parallel<T>(computations: Iterable<Async<T>>, token: CancellationToken) {
    return Async.delay(() =>
      Async.awaitPromise(
        Promise.all(Array.from(computations, (c) => Async.startAsPromise(c, token))),
      ),
    )
  }

  static of<T>(value: T) {
    return new Async<T>(protectedCont((ctx) => ctx.onSuccess(value)))
  }

  static ofError(err: Error) {
    return new Async<never>(protectedCont((ctx) => ctx.onError(err)))
  }

  static do<T>(f: () => Generator<Async<T>>): Async<T> {
    const pure = <T>(value: T) => Async.of(value)
    const bind = <T, V>(m: Async<T>, f: (value: T) => Async<V>) => m.chain(f)
    const gen = f()
    function doNext(value?: any): Async<T> {
      const curr = gen.next(value)
      if (curr.done) return pure(curr.value)
      return bind(curr.value, doNext)
    }
    return doNext()
  }
}
