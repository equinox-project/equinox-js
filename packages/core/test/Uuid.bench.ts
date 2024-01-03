import { bench } from "vitest"
import * as Uuid from "../src/lib/Uuid.js"
import { randomUUID } from "crypto"

const Id = Uuid.create<"Id">()

const random = randomUUID()

const uuidRegex =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/

const validateUuid = (str: string) => {
  const lower = str.toLowerCase()
  if (!uuidRegex.test(lower)) throw new Error(`Invalid UUID: ${str}`)
  return lower
}

bench("Uuid.parse(uuid)", () => {
  Id.parse(random)
})

bench("validateUuid(uuid)", () => {
  validateUuid(random)
})
