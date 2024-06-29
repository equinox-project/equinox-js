// Generated by ReScript, PLEASE EDIT WITH CARE

import * as PervasivesU from "rescript/lib/es6/pervasivesU.js";

var separator = "_";

function validate(raw) {
  if (raw === "") {
    return PervasivesU.failwith("StreamId: Element must not be empty");
  } else if (raw.includes(separator)) {
    return PervasivesU.failwith("StreamId: Element \"" + raw + "\" may not contain embedded '_' symbols");
  } else {
    return ;
  }
}

var $$Element = {
  separator: separator,
  validate: validate
};

function parseExactlyOne(raw) {
  validate(raw);
  return raw;
}

function compose(rawFragments) {
  rawFragments.forEach(validate);
  return rawFragments.join(separator);
}

function split(__x) {
  return __x.split(separator);
}

var Elements = {
  separator: separator,
  parseExactlyOne: parseExactlyOne,
  compose: compose,
  split: split
};

function parse(count, x) {
  var elements = x.split(separator);
  if (elements.length !== count) {
    PervasivesU.failwith("StreamId: Expected " + count.toString() + " elements, but got " + elements.length.toString() + " in \"" + x + "\"");
  }
  return elements;
}

function gen(f) {
  return function (a) {
    var raw = f(a);
    validate(raw);
    return raw;
  };
}

function gen2(f, g) {
  return function (a, b) {
    var a$1 = f(a);
    var b$1 = g(b);
    return compose([
                a$1,
                b$1
              ]);
  };
}

function gen3(f, g, h) {
  return function (a, b, c) {
    var a$1 = f(a);
    var b$1 = g(b);
    var c$1 = h(c);
    return compose([
                a$1,
                b$1,
                c$1
              ]);
  };
}

function gen4(f, g, h, i) {
  return function (a, b, c, d) {
    var a$1 = f(a);
    var b$1 = g(b);
    var c$1 = h(c);
    var d$1 = i(d);
    return compose([
                a$1,
                b$1,
                c$1,
                d$1
              ]);
  };
}

function genVariadic(fs) {
  return function (xs) {
    if (fs.length !== xs.length) {
      PervasivesU.failwith("StreamId.genVariadic: Unexpected parameter count. Expected " + fs.length.toString() + ", got " + xs.length.toString());
    }
    var parts = [];
    for(var i = 0 ,i_finish = fs.length; i < i_finish; ++i){
      var f = fs[i];
      var x = xs[i];
      parts.push(f(x));
    }
    return compose(parts);
  };
}

function dec(f) {
  return function (id) {
    return f(id);
  };
}

function dec2(f, g) {
  return function (id) {
    var elements = id.split(separator);
    if (elements.length !== 2) {
      return PervasivesU.failwith("StreamId: Expected 2 elements, but got " + elements.length.toString() + " in \"" + id + "\"");
    }
    var a = elements[0];
    var b = elements[1];
    return [
            f(a),
            g(b)
          ];
  };
}

function dec3(f, g, h) {
  return function (id) {
    var elements = id.split(separator);
    if (elements.length !== 3) {
      return PervasivesU.failwith("StreamId: Expected 3 elements, but got " + elements.length.toString() + " in \"" + id + "\"");
    }
    var a = elements[0];
    var b = elements[1];
    var c = elements[2];
    return [
            f(a),
            g(b),
            h(c)
          ];
  };
}

function dec4(f, g, h, i) {
  return function (id) {
    var elements = id.split(separator);
    if (elements.length !== 4) {
      return PervasivesU.failwith("StreamId: Expected 4 elements, but got " + elements.length.toString() + " in \"" + id + "\"");
    }
    var a = elements[0];
    var b = elements[1];
    var c = elements[2];
    var d = elements[3];
    return [
            f(a),
            g(b),
            h(c),
            i(d)
          ];
  };
}

export {
  $$Element ,
  Elements ,
  parseExactlyOne ,
  parse ,
  gen ,
  gen2 ,
  gen3 ,
  gen4 ,
  genVariadic ,
  dec ,
  dec2 ,
  dec3 ,
  dec4 ,
}
/* No side effect */
