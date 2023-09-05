import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js"
import http from "k6/http"

export const options = {
  vus: 80,
  duration: "20s",
}

export default function () {
  const payerId = "fb7b5c73-f57f-4345-a7e1-dd8006d0761d"
  const data = { payer_id: payerId, amount: 400, due_date: new Date().toISOString() }
  http.post("http://localhost:3000/invoice", JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  })
}
