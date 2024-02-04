import { ChargeId, GuestStayId } from "../src/domain/Types.js";

export const randomStays = (min = 0) => {
  const result: { stayId: GuestStayId; chargeId: ChargeId; amount: number }[] = []
  const count = Math.max(min, Math.floor(Math.random() * 10))
  for (let i = 0; i < count; ++i) {
    const stayId = GuestStayId.create()
    const chargeId = ChargeId.create()
    const amount = Math.floor(Math.random() * 100)
    result.push({ stayId, chargeId, amount })
  }
  return result
}
