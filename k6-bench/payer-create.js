import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js"
import http from "k6/http"

export const options = {
  vus: 80,
  duration: "20s",
}

const ids = [
  "2aec503d-a995-4901-ab47-cd5d4c289dc9",
  "0f8aa0b5-19a1-4a50-a21a-97a767a5bcb6",
  "01b72f12-6257-4035-8ab4-76ac12e9584f",
  "c35be60b-fadd-4740-a1f0-7f608bc4ca69",
  "60c4c9e2-a749-4944-849e-bfab055177f1",
  "587c7347-0e71-4995-a8e3-67a195974d36",
  "55ab573a-3cbd-48fa-95fd-2e77794faaf7",
  "73011657-64a0-4ada-8ab9-99f19a8c4cc3",
  "9bdf3573-5290-4d00-b756-4366e466b4b4",
  "19caccce-93b2-442f-aa0b-01a1cb003268",
]

export default function () {
  const name = Math.random() > 0.5 ? "Memememememe" : "Mamamamamama"
  const data = { name, email: "someone@somewhe.re" }
  const id = ids[Math.floor(Math.random() * ids.length)]
  http.put("http://localhost:3000/payer/" + id, JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  })
}
