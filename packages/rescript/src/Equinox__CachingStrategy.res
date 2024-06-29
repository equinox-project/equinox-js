type t
@module("@equinox-js/core") @scope("CachingStrategy") @val
external cached: Equinox__Cache.t => t = "Cache"

@module("@equinox-js/core") @scope("CachingStrategy") @val
external uncached: unit => t = "NoCache"
