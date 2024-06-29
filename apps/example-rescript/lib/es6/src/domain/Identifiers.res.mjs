// Generated by ReScript, PLEASE EDIT WITH CARE

import * as Decco from "@rescript-labs/decco/lib/es6/src/Decco.res.mjs";
import * as $$Crypto from "crypto";
import * as Js_json from "rescript/lib/es6/js_json.js";

function UUID($star) {
  var t_decode = function (v) {
    var s = Js_json.decodeString(v);
    if (s !== undefined) {
      return {
              TAG: "Ok",
              _0: s
            };
    } else {
      return Decco.error(undefined, "invalid ID", v);
    }
  };
  var t_encode = function (v) {
    return v;
  };
  var create = function () {
    return $$Crypto.randomUUID();
  };
  return {
          t_decode: t_decode,
          t_encode: t_encode,
          create: create
        };
}

function t_decode(v) {
  var s = Js_json.decodeString(v);
  if (s !== undefined) {
    return {
            TAG: "Ok",
            _0: s
          };
  } else {
    return Decco.error(undefined, "invalid ID", v);
  }
}

function t_encode(v) {
  return v;
}

function create() {
  return $$Crypto.randomUUID();
}

var PayerId = {
  t_decode: t_decode,
  t_encode: t_encode,
  create: create
};

function t_decode$1(v) {
  var s = Js_json.decodeString(v);
  if (s !== undefined) {
    return {
            TAG: "Ok",
            _0: s
          };
  } else {
    return Decco.error(undefined, "invalid ID", v);
  }
}

function t_encode$1(v) {
  return v;
}

function create$1() {
  return $$Crypto.randomUUID();
}

var InvoiceId = {
  t_decode: t_decode$1,
  t_encode: t_encode$1,
  create: create$1
};

export {
  UUID ,
  PayerId ,
  InvoiceId ,
}
/* crypto Not a pure module */
