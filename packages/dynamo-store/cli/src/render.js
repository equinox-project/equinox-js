import util from "util"
import supportsColor from "supports-color"
const colors = {
  Text: "\x1b[38;5;0253m",
  SecondaryText: "\x1b[38;5;0246m",
  TertiaryText: "\x1b[38;5;0242m",
  Invalid: "\x1b[33;1m",
  Null: "\x1b[38;5;0038m",
  Name: "\x1b[38;5;0081m",
  String: "\x1b[38;5;0216m",
  Number: "\x1b[38;5;151m",
  Boolean: "\x1b[38;5;0038m",
  Scalar: "\x1b[38;5;0079m",
  LevelVerbose: "\x1b[37m",
  LevelDebug: "\x1b[37m",
  LevelInformation: "\x1b[37;1m",
  LevelWarning: "\x1b[38;5;0229m",
  LevelError: "\x1b[38;5;0197m\x1b[48;5;0238m",
  LevelFatal: "\x1b[38;5;0197m\x1b[48;5;0238m",
}

const close = "\x1b[0m"

/** @type {{[P in keyof typeof colors]: (str: string) => string}} */
export const chalk = Object.fromEntries(
  Object.entries(colors).map(([key, value]) => [
    key,
    supportsColor.stdout ? (str) => `${value}${str}${close}` : (s) => s,
  ]),
)

function renderValue(value) {
  switch (typeof value) {
    case "string":
      return chalk.String(util.inspect(value))
    case "number":
      return chalk.Number(util.inspect(value))
    case "boolean":
      return chalk.Boolean(value ? "True" : "False")
    case "object":
      if (value == null) {
        valueString = chalk.Null(String(value))
      } else if (Array.isArray(value)) {
        return (
          chalk.SecondaryText("[") +
          value.map(renderValue).join(chalk.TertiaryText(", ")) +
          chalk.SecondaryText("]")
        )
      } else {
        return renderObject(value)
      }
  }

  return chalk.Invalid(valueString)
}

export function renderObject(attributes) {
  const keys = Object.keys(attributes)
  let logStr = ""
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    logStr += `${chalk.Name(key)}${chalk.TertiaryText("=")}${renderValue(attributes[key])}`
    if (i !== keys.length - 1) logStr += chalk.TertiaryText(", ")
  }

  return `${chalk.TertiaryText("{")}${logStr}${chalk.TertiaryText("}")}`
}
