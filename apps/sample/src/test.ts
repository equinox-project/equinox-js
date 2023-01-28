import { ddbContext, caching } from "./modules/context.js"
import * as Todo from "./modules/Todo"
import { randomUUID } from "node:crypto"

const service = Todo.Service.buildDynamo(ddbContext, caching)
const id = randomUUID()
console.time("appendAll")
for (let i = 0; i < 1000; ++i) {
  console.time("append")
  await service.add(id, { id: -1, completed: false, order: 0, title: "My todo " + i })
  console.timeEnd("append")
}
console.timeEnd("appendAll")
const result = await service.read(id)
console.log(result)
