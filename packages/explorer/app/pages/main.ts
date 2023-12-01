import m from "mithril"
import {
  loadEventsByDay,
  loadRecentStreams,
  loadEventsByCategory,
  StreamData,
  EventData,
  CategoryData,
} from "../data-access/data-access"
import { formatDistanceToNow } from "date-fns"
import { BarChart } from "../components/bar-chart"
import { Table } from "../components/table"
import { Navbar } from "../layout/navbar"

export const MainPage = () => {
  let streams: StreamData[] = []
  let events: EventData[] = []
  let categories: CategoryData[] = []

  let isLoading = true
  let eventsP = loadEventsByDay().then((x) => {
    events = x
  })
  let streamsP = loadRecentStreams().then((x) => {
    streams = x
  })
  let categoriesP = loadEventsByCategory().then((x) => {
    categories = x
  })

  Promise.all([eventsP, streamsP, categoriesP]).then(() => {
    isLoading = false
    m.redraw()
  })

  return {
    view() {
      if (isLoading) {
        return [
          m(Navbar),
          m("main.container.mx-auto.mt-8", [
            m("h1.text-3xl", "Welcome to equinox-explorer"),
            m("h3.text-xl.mb-4", "Loading..."),
          ]),
        ]
      }

      return [
        m(Navbar),
        m("main.container.mx-auto.mt-8", [
          m("h1.text-3xl", "Welcome to equinox-explorer"),

          m("section.grid.lg:grid-cols-3.md:grid-cols-2.grid-cols-1.gap-4.mt-8", [
            m("section.lg:col-span-3.md:col-span-2", [
              m("h3.text-xl.mb-4", "Events appended (Last 7 days)"),
              m(BarChart, {
                data: events.map((event) => ({ x: event.date, y: Number(event.count) })),
                height: 200,
              }),
            ]),

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
              m("h3.text-xl.mb-4", ["Most active categories"]),
              m(Table, {
                columns: ["Category", "Count"],
                data: categories.map((category) => [
                  m(
                    "a.text-blue-500",
                    { href: `#!/category/${category.category}` },
                    category.category,
                  ),
                  category.count.toLocaleString(),
                ]),
              }),
            ]),
          ]),
        ]),
      ]
    },
  }
}
