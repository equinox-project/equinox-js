type t

external trust: string => t = "%identity"
external toString: t => string = "%identity"

module Element = {
  let separator = "_"
  let validate = raw =>
    switch raw {
    | "" => failwith("StreamId: Element must not be empty")
    | raw if raw->String.includes(separator) =>
      failwith(`StreamId: Element "${raw}" may not contain embedded '_' symbols`)
    | _ => ()
    }
}

module Elements = {
  let separator = Element.separator
  let parseExactlyOne = raw => {
    Element.validate(raw)
    trust(raw)
  }
  let compose = rawFragments => {
    rawFragments->Array.forEach(Element.validate)
    rawFragments->Array.join(separator)->trust
  }
  let split = String.split(_, separator)
}

let parseExactlyOne = Elements.parseExactlyOne
let parse = (count, x) => {
  let elements = Elements.split(x)
  if elements->Array.length != count {
    failwith(
      `StreamId: Expected ${Int.toString(count)} elements, but got ${Int.toString(
          Array.length(elements),
        )} in "${x}"`,
    )
  }
  elements
}

let gen = f => a => Elements.parseExactlyOne(f(a))
let gen2 = (f, g) => (a, b) => {
  let a = f(a)
  let b = g(b)
  Elements.compose([a, b])
}
let gen3 = (f, g, h) => (a, b, c) => {
  let a = f(a)
  let b = g(b)
  let c = h(c)
  Elements.compose([a, b, c])
}
let gen4 = (f, g, h, i) => (a, b, c, d) => {
  let a = f(a)
  let b = g(b)
  let c = h(c)
  let d = i(d)
  Elements.compose([a, b, c, d])
}

let genVariadic = fs => xs => {
  if Array.length(fs) != Array.length(xs) {
    failwith(
      `StreamId.genVariadic: Unexpected parameter count. Expected ${Int.toString(
          Array.length(fs),
        )}, got ${Int.toString(Array.length(xs))}`,
    )
  }
  let parts = []
  for i in 0 to Array.length(fs) - 1 {
    let f = fs->Array.getUnsafe(i)
    let x = xs->Array.getUnsafe(i)
    parts->Array.push(f(x))
  }
  Elements.compose(parts)
}

let dec = f => id => f(toString(id))
let dec2 = (f, g) => id =>
  switch Elements.split(toString(id)) {
  | [a, b] => [f(a), g(b)]
  | elements =>
    failwith(
      `StreamId: Expected 2 elements, but got ${Int.toString(
          Array.length(elements),
        )} in "${toString(id)}"`,
    )
  }
let dec3 = (f, g, h) => id =>
  switch Elements.split(toString(id)) {
  | [a, b, c] => [f(a), g(b), h(c)]
  | elements =>
    failwith(
      `StreamId: Expected 3 elements, but got ${Int.toString(
          Array.length(elements),
        )} in "${toString(id)}"`,
    )
  }
let dec4 = (f, g, h, i) => id =>
  switch Elements.split(toString(id)) {
  | [a, b, c, d] => [f(a), g(b), h(c), i(d)]
  | elements =>
    failwith(
      `StreamId: Expected 4 elements, but got ${Int.toString(
          Array.length(elements),
        )} in "${toString(id)}"`,
    )
  }
