import http from "k6/http"

export const options = {
  vus: 80,
  duration: "20s",
}

export default function () {
  const payerId = "587c7347-0e71-4995-a8e3-67a195974d36"
  const data = { payer_id: payerId, amount: 400, due_date: new Date().toISOString() }
  http.post("http://localhost:3000/invoice", JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  })
}
