import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { GroupCheckout, GuestStay } from "../domain/index.js"
import * as GroupCheckoutProcessor from "./GroupCheckoutProcessor.js"
import { StreamResult, StreamsSink } from "@equinox-js/propeller"
import * as Config from "../config/equinox.js"

export function createHandler(processor: GroupCheckoutProcessor.Service) {
  return async function handle(stream: StreamName, _events: ITimelineEvent[]) {
    const id = GroupCheckout.Stream.tryMatch(stream)
    if (!id) throw new Error(`Span from unexpected category: ${stream}`)
    const version = await processor.react(id)
    return StreamResult.OverrideNextIndex(version)
  }
}

export function createSink(config: Config.Config) {
  const stays = GuestStay.Service.create(config)
  const groupCheckouts = GroupCheckout.Service.create(config)
  const processor = new GroupCheckoutProcessor.Service(stays, groupCheckouts, 10)
  return StreamsSink.create({
    handler: createHandler(processor),
    maxReadAhead: 3,
    maxConcurrentStreams: 10
  })
}
