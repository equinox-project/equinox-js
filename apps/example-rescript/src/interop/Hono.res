type t
@module("hono") @new external make: unit => t = "Hono"

module Request = {
  type t
  @send external params: t => Js.Dict.t<string> = "param"
  @send external query: t => Js.Dict.t<string> = "query"
  @send external queries: t => Js.Dict.t<array<string>> = "queries"
  @send external header: t => Js.Dict.t<string> = "header"

  @send external json: t => Js.Promise.t<'a> = "json"
  @send external text: t => Js.Promise.t<string> = "text"

  @get
  external method: t => [
    | #GET
    | #HEAD
    | #POST
    | #PUT
    | #DELETE
    | #CONNECT
    | #OPTIONS
    | #TRACE
    | #PATCH
  ] = "method"
}

type response

type headers = Js.Dict.t<array<string>>

module Context = {
  type t
  @get external req: t => Request.t = "req"
  @send external body: (t, string) => response = "body"
  @send external text: (t, string) => response = "text"
  @send external json: (t, 'a) => response = "json"
  @send external html: (t, string) => response = "html"
  @send external notFound: t => response = "notFound"
  @send external redirect: (t, string) => response = "redirect"
  @send external redirectStatus: (t, string, int) => response = "redirect"
  @get external res: t => response = "res"

  @send external status: (t, int) => unit = "status"
  @send external header: (t, string, string) => unit = "header"

  @get external var: t => 'var = "var"
}

type handler<'var> = Context.t => Js.Promise.t<response>

@send external get: (t, string, handler<'var>) => unit = "get"
@send external put: (t, string, handler<'var>) => unit = "put"
@send external post: (t, string, handler<'var>) => unit = "post"
@send external delete: (t, string, handler<'var>) => unit = "delete"
@send external notFound: (t, handler<'var>) => unit = "notFound"

let void = (_t: t) => ()

type fetch
@get external fetch: t => fetch = "fetch"

type options = {port: int, fetch: fetch}

@module("@hono/node-server") external serve: options => unit = "serve"
