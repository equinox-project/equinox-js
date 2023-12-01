import { ITimelineEvent, StreamName } from "@equinox-js/core"
import m from "mithril"

const baseURL = "/api"

export type StreamEvent = {
  id: string
  type: string
  time: string
  data: any
  meta: any
  state: any
  index: string
  decodable: boolean
}

export type StreamData = { stream_name: string; time: string }
export type EventData = { date: string; count: number }
export type CategoryData = { category: string; count: number }
export type StreamPageData = {
  initial: any
  events: StreamEvent[]
}

export const loadRecentStreams = (category?: string) =>
  m.request<StreamData[]>(`${baseURL}/recent-streams`, { params: { category } })
export const loadEventsByDay = (category?: string) =>
  m.request<EventData[]>(`${baseURL}/events-by-day`, { params: { category } })
export const loadEventsByCategory = () => m.request<CategoryData[]>(`${baseURL}/events-by-category`)
export const loadStreamPageData = (stream_name: string) =>
  m.request<StreamPageData>(`${baseURL}/stream/${stream_name}`)
export const loadCorrelatedEvents = (correlationId: string) =>
  m.request<[StreamName, ITimelineEvent][]>(`${baseURL}/correlation/${correlationId}`)
