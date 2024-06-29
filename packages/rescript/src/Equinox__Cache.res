type t

@module("@equinox-js/core") @new
external createMemory: unit => t = "MemoryCache"

@module("@equinox-js/core") @new
external createMemoryWithCapacity: int => t = "MemoryCache"
