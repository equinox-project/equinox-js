import { caching, ddbContext } from "../modules/context"
import * as Todo from "../modules/Todo"

const defaultId = "00000000-0000-0000-0000-000000000000"

const service = Todo.create(ddbContext, caching)

/** @type {import('./$types').PageServerLoad} */
export async function load() {
  const todos = await service.read(defaultId)
  return { todos }
}

/** @type {import('./$types').Actions} */
export const actions = {
  async create(event) {
    const data = await event.request.formData()
    await service.add(defaultId, {
      id: -1,
      title: String(data.get("title")),
      order: 0,
      completed: false,
    })
    return { success: true }
  },

  async clear() {
    await service.clear(defaultId)
    return { success: true }
  },

  async remove(event) {
    const data = await event.request.formData()
    const todoId = Number(data.get("todoId"))
    if (Number.isNaN(todoId)) throw new Error("invalid id")
    await service.delete(defaultId, todoId)
    return { success: true }
  },

  async complete(event) {
    const data = await event.request.formData()
    const todoId = Number(data.get("todoId"))
    if (Number.isNaN(todoId)) throw new Error("invalid id")
    await service.complete(defaultId, todoId)
    return { success: true }
  },
}
