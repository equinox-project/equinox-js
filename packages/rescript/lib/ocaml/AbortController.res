type t = {signal: AbortSignal.t}

@new
external make: unit => t = "AbortController"

@send
external abort: t => unit = "abort"
