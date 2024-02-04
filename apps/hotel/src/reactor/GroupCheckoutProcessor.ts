import { match } from "variant"
import { GroupCheckout, GuestStay } from "../domain/index.js"
import { GroupCheckoutId, GuestStayId } from "../domain/Types.js"
import { trace } from "@opentelemetry/api"
import pLimit from "p-limit"

export class Service {
  constructor(
    private readonly guestStays: GuestStay.Service,
    private readonly groupCheckouts: GroupCheckout.Service,
    private readonly checkoutParalellism: number,
  ) {}

  private async attemptMerge(groupCheckoutId: GroupCheckoutId, stayId: GuestStayId) {
    const result = await this.guestStays.groupCheckout(stayId, groupCheckoutId)
    return match(result, {
      Ok: ({ residualBalance }) => [stayId, residualBalance] as const,
      AlreadyCheckedOut: () => stayId,
    })
  }

  private async executeMergeStayAttempts(groupCheckoutId: GroupCheckoutId, stayIds: GuestStayId[]) {
    const residuals: Readonly<[GuestStayId, number]>[] = []
    const failed: GuestStayId[] = []
    const limit = pLimit(this.checkoutParalellism)
    await Promise.all(
      stayIds.map((id) =>
        limit(() =>
          this.attemptMerge(groupCheckoutId, id).then((x) =>
            typeof x == "string" ? failed.push(x) : residuals.push(x),
          ),
        ),
      ),
    )
    return [residuals, failed] as const
  }

  private async decideMerge(groupCheckoutId: GroupCheckoutId, stayIds: GuestStayId[]) {
    const [residuals, failed] = await this.executeMergeStayAttempts(groupCheckoutId, stayIds)
    const events: GroupCheckout.Events.Event[] = []
    if (residuals.length > 0) {
      events.push(
        GroupCheckout.Events.Event.StaysMerged({
          residuals: residuals.map(([stay, residual]) => ({ stay, residual })),
        }),
      )
    }
    if (failed.length > 0) {
      events.push(GroupCheckout.Events.Event.MergesFailed({ stays: failed }))
    }
    const span = trace.getActiveSpan()
    span?.setAttributes({
      "app.outcome.type": "Merged",
      "app.outcome.ok": residuals.length,
      "app.outcome.failed": failed.length,
    })
    return events
  }

  private async handleReaction(groupCheckoutId: GroupCheckoutId, act: GroupCheckout.Flow.State) {
    switch (act.type) {
      case "MergeStays":
        return this.decideMerge(groupCheckoutId, act.stays)
      case "Ready":
      case "Finished":
        trace.getActiveSpan()?.setAttribute("app.outcome.type", "Noop")
        return []
    }
  }

  async react(groupCheckoutId: GroupCheckoutId) {
    return this.groupCheckouts.react(groupCheckoutId, (act) =>
      this.handleReaction(groupCheckoutId, act),
    )
  }
}
