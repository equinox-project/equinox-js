import { describe, test, expect } from "vitest"
import { collapseChanges } from "../src/collapse.js"
import { Delete, Insert, Update, Upsert } from "../src/index.js"

describe("Collapsing changesets", () => {
  test("Deleting in the same changeset as inserting", () => {
    const changes = [
      Insert({ id: 1, name: "bob", age: 30 }),
      Update({ id: 1, name: "bob", age: 31 }),
      Delete({ id: 1 }),
    ]
    expect(collapseChanges(changes)).toEqual([])
  })

  test("Inserting with updates", () => {
    const changes = [
      Insert({ id: 1, name: "bob", age: 30 }),
      Update({ id: 1, name: "bobby", age: 31 }),
      Update({ id: 1, age: 32 }),
    ]
    expect(collapseChanges(changes)).toEqual([Insert({ id: 1, name: "bobby", age: 32 })])
  })

  test("Inserting with delete and another insert", () => {
    const changes = [
      Insert({ id: 1, name: "bob", age: 30 }),
      Delete({ id: 1 }),
      Insert({ id: 1, name: "bobby", age: 31 }),
    ]
    expect(collapseChanges(changes)).toEqual([Insert({ id: 1, name: "bobby", age: 31 })])
  })

  test("Upserts", () => {
    const changes = [
      Upsert({ id: 1, name: "bob", age: 30 }),
      Upsert({ id: 1, name: "bobby", age: 31 }),
    ]
    expect(collapseChanges(changes)).toEqual([Upsert({ id: 1, name: "bobby", age: 31 })])
  })

  test("Upsert with deletes", () => {
    const changes = [
      Upsert({ id: 1, name: "bob", age: 30 }),
      Delete({ id: 1 }),
      Upsert({ id: 1, name: "bobby", age: 31 }),
    ]
    expect(collapseChanges(changes)).toEqual([Upsert({ id: 1, name: "bobby", age: 31 })])
  })

  test("The whole shebang", () => {
    const changes = [
      Insert({ id: 1, name: "bob", age: 30 }),
      Update({ id: 1, name: "bobby", age: 31 }),
      Delete({ id: 1 }),
      Insert({ id: 1, name: "bobby", age: 32 }),
      Upsert({ id: 1, name: "bobby", age: 33 }),
      Update({ id: 1, name: "blob" }),
    ]
    expect(collapseChanges(changes)).toEqual([Insert({ id: 1, name: "blob", age: 33 })])
  })
})
