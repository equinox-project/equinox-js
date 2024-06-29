type t

module StreamId = Equinox__StreamId

external trust: string => t = "%identity"
external toString: t => string = "%identity"

module Category = {
  let separator = "-"
  let validate = raw =>
    switch raw {
    | "" => failwith("StreamName: Category element must not be empty")
    | raw if raw->String.includes(separator) =>
      failwith(`StreamName: Category element "${raw}" must not contain embedded '-' symbols`)
    | _ => ()
    }

  let ofStreamName = x => x->String.slice(~start=0, ~end=String.indexOf(x, separator))
}

let category = Category.ofStreamName

module Internal = {
  let tryParse = raw => {
    let idx = String.indexOf(raw, Category.separator)
    let category = raw->String.substring(~start=0, ~end=idx)
    let id = raw->String.substringToEnd(~start=idx + 1)
    if idx < 0 || id == "" || category == "" {
      None
    } else {
      Some(category, StreamId.trust(id))
    }
  }
}

let parse = x => {
  let idx = String.indexOf(x, Category.separator)
  if idx < 0 {
    failwith(`StreamName "${x}" must contain a category separator "${Category.separator}"`)
  }
  trust(x)
}

let create = (category, id) => {
  Category.validate(category)
  trust(category ++ Category.separator ++ StreamId.toString(id))
}

let compose = (category, elements) => create(category, StreamId.Elements.compose(elements))

let split = x => {
  switch Internal.tryParse(x) {
  | None => failwith(`StreamName "${x}" is invalid`)
  | Some(x) => x
  }
}

let tryMatch = (category, dec) => x =>
  switch split(x) {
  | (cat, id) if cat == category => Some(dec(id))
  | _ => None
  }

let tryFind = cat => tryMatch(cat, x => x)

let gen = (category, streamId) => id => create(category, streamId(id))
let gen2 = (category, streamId) => (a, b) => create(category, streamId(a, b))
let gen3 = (category, streamId) => (a, b, c) => create(category, streamId(a, b, c))
let gen4 = (category, streamId) => (a, b, c, d) => create(category, streamId(a, b, c, d))
