import { ITimelineEvent, StreamName } from "@equinox-js/core"
import m from "mithril"
import { loadCorrelatedEvents } from "../data-access/data-access"
import { CorrelationGraph } from "../components/correlation-chart"
import { Navbar } from "../layout/navbar"

const BasicEventCard: m.ClosureComponent<{ event: [StreamName, ITimelineEvent] }> = (vnode) => {
  const [streamName, event] = vnode.attrs.event
  const data = event.data
  const meta = event.meta
  const time = event ? new Date(event.time).toLocaleString() : null

  return {
    view() {
      return m("li.w-full.rounded.mt-8.bg-gray-50.dark:bg-gray-800", [
        m("div.px-6.py-4", [
          m("h4.text-xl.text-gray-700.dark:text-gray-50", `${event.type} in (${streamName})`),
          m("hr"),
          time ? m("span.text-gray-700.dark:text-gray-50", time) : null,
          m("section.grid.gap-4.mt-4.md:grid-cols-2.sm:grid-cols-1", [
            m("div", [
              m("h5.text-lg.text-gray-700.dark:text-gray-50", "Data"),
              event?.data
                ? m("json-viewer.p-4", { data: data })
                : m("p.text-gray-700.dark:text-gray-50", "No data"),
            ]),
            m("div", [
              m("h5.text-lg.text-gray-700.dark:text-gray-50", "Meta"),
              event?.meta
                ? m("json-viewer.p-4", { data: meta })
                : m("p.text-gray-700.dark:text-gray-50", "No meta"),
            ]),
          ]),
        ]),
      ])
    },
  }
}

export const CorrelationPage: m.ClosureComponent<{ correlation_id: string }> = (vnode) => {
  let data: [StreamName, ITimelineEvent][] = []
  let correlations: any[] = []
  let isLoading = true

  loadCorrelatedEvents(vnode.attrs.correlation_id).then((x) => {
    isLoading = false
    data = x
    const corrs = []
    for (const [streamName, event] of data) {
      const meta = event.meta as any
      if (meta?.$causationId) {
        corrs.push({
          id: event.id,
          causationId: meta.$causationId,
          time: event.time,
          type: event.type,
          streamName,
        })
      }
    }
    correlations = corrs
    m.redraw()
  })
  return {
    view(vnode) {
      return [
        m(Navbar),
        m("main.container.mx-auto.mt-8", [
          m("h1.text-3xl", ["Correlation ", vnode.attrs.correlation_id]),
          correlations.length > 0
            ? m("section.mt-8", [
                m("h2.text-2xl", "Correlation tree"),
                m(CorrelationGraph, { correlations }),
              ])
            : null,

          m("section", [m("ul", [data.map((x) => m(BasicEventCard, { event: x }))])]),
        ]),
      ]
    },
  }
}
