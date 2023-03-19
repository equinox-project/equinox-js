export type IEventData<Format> = {
  /** optional id for the event */
  id?: string
  /** The event type */
  type: string
  /** The event data in `Format`, typically a JSON string */
  data?: Format
  /** The event metadata in `Format`, typically a JSON string */
  meta?: Format
}

export type ITimelineEvent<Format> = {
  /** The ID of the event */
  id: string
  /**
   * The timestamp of the event, for mechanical purposes only.
   * Typically, denotes the time an event was stored.
   * Not to be conflated with when the event happened
   */
  time: Date
  /** The type of the event */
  type: string
  data?: Format
  meta?: Format
  /** The 0-based index of the event in its own stream */
  index: bigint
  /** denotes that the event is an unfold or snapshot */
  isUnfold: boolean
  /** size in bytes */
  size: number
}
