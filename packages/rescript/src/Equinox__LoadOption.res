type t' = {requireLoad?: bool, requireLeader?: bool, maxStaleMs?: float, assumeEmpty?: bool}
type t =
  | RequireLoad
  | RequireLeader
  | AnyCachedValue
  | MaxStale(int)
  | AssumeEmpty
let to_eqx = x =>
  switch x {
  | RequireLoad => {requireLoad: true}
  | RequireLeader => {requireLeader: true}
  | AnyCachedValue => {maxStaleMs: 9007199254740991.}
  | MaxStale(maxStaleMs) => {maxStaleMs: float_of_int(maxStaleMs)}
  | AssumeEmpty => {assumeEmpty: true}
  }
