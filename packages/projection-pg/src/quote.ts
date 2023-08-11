/*
 * The MIT License (MIT)
 * 
 * Copyright (c) 2014 Datalanche, Inc.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */


function formatDate(date) {
  date = date.replace("T", " ")
  date = date.replace("Z", "+00")
  return date
}

export function ident(value: unknown) {
  if (value === undefined || value === null) {
    throw new Error("SQL identifier cannot be null or undefined")
  } else if (value === false) {
    return '"f"'
  } else if (value === true) {
    return '"t"'
  } else if (value instanceof Date) {
    return '"' + formatDate(value.toISOString()) + '"'
  } else if (value instanceof Buffer) {
    throw new Error("SQL identifier cannot be a buffer")
  } else if (Array.isArray(value)) {
    var temp = []
    for (var i = 0; i < value.length; i++) {
      if (Array.isArray(value[i]) === true) {
        throw new Error(
          "Nested array to grouped list conversion is not supported for SQL identifier",
        )
      } else {
        temp.push(quoteIdent(value[i]))
      }
    }
    return temp.toString()
  } else if (value === Object(value)) {
    throw new Error("SQL identifier cannot be an object")
  }

  var ident = value.toString().slice(0) // create copy

  // do not quote a valid, unquoted identifier
  if (/^[a-z_][a-z0-9_$]*$/.test(ident) === true && isReserved(ident) === false) {
    return ident
  }

  var quoted = '"'

  for (var i = 0; i < ident.length; i++) {
    var c = ident[i]
    if (c === '"') {
      quoted += c + c
    } else {
      quoted += c
    }
  }

  quoted += '"'

  return quoted
}

function isReserved(value) {
  return reserved.has(value.toUpperCase())
}

const reserved = new Set([
  "AES128",
  "AES256",
  "ALL",
  "ALLOWOVERWRITE",
  "ANALYSE",
  "ANALYZE",
  "AND",
  "ANY",
  "ARRAY",
  "AS",
  "ASC",
  "AUTHORIZATION",
  "BACKUP",
  "BETWEEN",
  "BINARY",
  "BLANKSASNULL",
  "BOTH",
  "BYTEDICT",
  "CASE",
  "CAST",
  "CHECK",
  "COLLATE",
  "COLUMN",
  "CONSTRAINT",
  "CREATE",
  "CREDENTIALS",
  "CROSS",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "CURRENT_USER",
  "CURRENT_USER_ID",
  "DEFAULT",
  "DEFERRABLE",
  "DEFLATE",
  "DEFRAG",
  "DELTA",
  "DELTA32K",
  "DESC",
  "DISABLE",
  "DISTINCT",
  "DO",
  "ELSE",
  "EMPTYASNULL",
  "ENABLE",
  "ENCODE",
  "ENCRYPT",
  "ENCRYPTION",
  "END",
  "EXCEPT",
  "EXPLICIT",
  "FALSE",
  "FOR",
  "FOREIGN",
  "FREEZE",
  "FROM",
  "FULL",
  "GLOBALDICT256",
  "GLOBALDICT64K",
  "GRANT",
  "GROUP",
  "GZIP",
  "HAVING",
  "IDENTITY",
  "IGNORE",
  "ILIKE",
  "IN",
  "INITIALLY",
  "INNER",
  "INTERSECT",
  "INTO",
  "IS",
  "ISNULL",
  "JOIN",
  "LEADING",
  "LEFT",
  "LIKE",
  "LIMIT",
  "LOCALTIME",
  "LOCALTIMESTAMP",
  "LUN",
  "LUNS",
  "LZO",
  "LZOP",
  "MINUS",
  "MOSTLY13",
  "MOSTLY32",
  "MOSTLY8",
  "NATURAL",
  "NEW",
  "NOT",
  "NOTNULL",
  "NULL",
  "NULLS",
  "OFF",
  "OFFLINE",
  "OFFSET",
  "OLD",
  "ON",
  "ONLY",
  "OPEN",
  "OR",
  "ORDER",
  "OUTER",
  "OVERLAPS",
  "PARALLEL",
  "PARTITION",
  "PERCENT",
  "PLACING",
  "PRIMARY",
  "RAW",
  "READRATIO",
  "RECOVER",
  "REFERENCES",
  "REJECTLOG",
  "RESORT",
  "RESTORE",
  "RIGHT",
  "SELECT",
  "SESSION_USER",
  "SIMILAR",
  "SOME",
  "SYSDATE",
  "SYSTEM",
  "TABLE",
  "TAG",
  "TDES",
  "TEXT255",
  "TEXT32K",
  "THEN",
  "TO",
  "TOP",
  "TRAILING",
  "TRUE",
  "TRUNCATECOLUMNS",
  "UNION",
  "UNIQUE",
  "USER",
  "USING",
  "VERBOSE",
  "WALLET",
  "WHEN",
  "WHERE",
  "WITH",
  "WITHOUT",
])
