import m from "mithril"
import { formatDistanceToNow } from "date-fns"
import {
  loadEventsByDay,
  loadRecentStreams,
  EventData,
  StreamData,
} from "../data-access/data-access"
import { BarChart } from "../components/bar-chart"
import { Table } from "../components/table"
import { Navbar } from "../layout/navbar"

export const CategoryPage: m.ClosureComponent<{ category: string }> = (vnode) => {
  let events: EventData[] = []
  let streams: StreamData[] = []

  let isLoading = true
  let eventP = loadEventsByDay(vnode.attrs.category).then((x) => {
    events = x
  })
  let streamsP = loadRecentStreams(vnode.attrs.category).then((x) => {
    streams = x
  })

  Promise.all([eventP, streamsP]).then(() => {
    isLoading = false
    m.redraw()
  })

  return {
    view() {
      if (isLoading) {
        return [
          m(Navbar),
          m("main.container.mx-auto.mt-8", [
            m("h1.text-3xl", ["Category ", vnode.attrs.category]),
            m("h3.text-xl.mb-4", "Loading..."),
          ]),
        ]
      }
      return [
        m(Navbar),
        m("main.container.mx-auto.mt-8", [
          m("h1.text-3xl", ["Category ", vnode.attrs.category]),
          m("section.grid.grid-cols-2.gap-4.mt-8", [
            m("section", [
              m("h3.text-xl.mb-4", "Recent streams"),
              m(Table, {
                columns: ["Stream Name", "Time"],
                data: streams.map((stream) => [
                  m(
                    "a.text-blue-500",
                    { href: `#!/stream/${stream.stream_name}` },
                    stream.stream_name,
                  ),
                  formatDistanceToNow(new Date(stream.time), { addSuffix: true }),
                ]),
              }),
            ]),
            m("section", [
              m("h3.text-xl.mb-4", "Events appended (Last 7 days)"),
              m(BarChart, {
                data: events.map((event) => ({ x: event.date, y: Number(event.count) })),
                height: 500,
              }),
            ]),
          ]),
        ]),
      ]
    },
  }
}
