export type StreamEvent = {
  /* optional id for the event */
  id?: string
  type: string
  data: any
  metadata?: any
}

export type TimelineEvent = {
  id: string
  time: Date
  type: string
  data: any
  metadata: any
  stream_name: string
  position: bigint
}

export type Codec<E, C=undefined> = {
  decode(event: TimelineEvent): E | undefined
  encode(event: E, ctx: C): StreamEvent
}
