export type StreamEvent<Format> = {
  /* optional id for the event */
  id?: string
  type: string
  data: Format
  meta: Format
}

export type TimelineEvent<Format> = {
  id: string
  time: Date
  type: string
  data: Format
  meta: Format
  index: bigint
  isUnfold: boolean
  size: number
}
