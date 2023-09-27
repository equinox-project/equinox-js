type t
@module external process: t = "process"

@send
external onSigint: (t, @as("SIGINT") _, @uncurry (unit => unit)) => t = "on"

@send
external onSigterm: (t, @as("SIGTERM") _, @uncurry (unit => unit)) => t = "on"
