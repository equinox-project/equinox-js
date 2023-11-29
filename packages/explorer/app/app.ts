// @jsx-pragma m
import m from "mithril"
import { formatDistanceToNow } from "date-fns"
import { ITimelineEvent, StreamName } from "@equinox-js/core"
import { CorrelationGraph } from "./components/correlation-chart"
import { BarChart } from "./components/bar-chart"

const Table: m.Component<{ columns: string[]; data: m.Child[][] }> = {
  view(vnode) {
    const cols = vnode.attrs.columns
    const data = vnode.attrs.data
    return m(
      "table.table-auto.w-full.text-sm.text-left.rtl:text-right.text-gray-500.dark:text-gray-400",
      [
        m("thead.text-xs.text-gray-700.uppercase.bg-gray-50.dark:bg-gray-700.dark:text-gray-400", [
          m("tr", [cols.map((col) => m("th[scope=col].px-6.py-3", col))]),
        ]),
        m("tbody", [
          data.map((cols) =>
            m("tr.bg-white.border-b.dark:bg-gray-800.dark:border-gray-700", [
              cols.map((col) => m("td.px-6.py-3", col)),
            ]),
          ),
        ]),
      ],
    )
  },
}

type MainPageData = {
  streams: { stream_name: string; time: string }[]
  events: { date: string; count: number }[]
  categories: { category: string; count: number }[]
}

type StreamData = { stream_name: string; time: string }
type EventData = { date: string; count: number }
type CategoryData = { category: string; count: number }

const loadMainData = () =>
  Promise.all([
    m.request<StreamData[]>("http://localhost:3000/equinox-explorer/recent-streams"),
    m.request<EventData[]>("http://localhost:3000/equinox-explorer/events-by-day"),
    m.request<CategoryData[]>("http://localhost:3000/equinox-explorer/events-by-category"),
  ]).then(([streams, events, categories]): MainPageData => ({ streams, events, categories }))

const MainPage = () => {
  let data: MainPageData = {
    streams: [],
    events: [],
    categories: [],
  }

  let isLoading = true
  loadMainData().then((x) => {
    isLoading = false
    data = x
  })

  return {
    view() {
      return m("main.container.mx-auto.mt-8", [
        m("h1.text-3xl", "Welcome to equinox-explorer"),
        m("section.grid.grid-cols-3.gap-4.mt-8", [
          m("section", [
            m("h3.text-xl.mb-4", "Recent streams"),
            m(Table, {
              columns: ["Stream Name", "Time"],
              data: data.streams.map((stream) => [
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
              data: data.events.map((event) => ({ x: event.date, y: Number(event.count) })),
              height: 500,
            }),
          ]),
          m("section", [
            m("h3.text-xl.mb-4", ["Most active categories"]),
            m(Table, {
              columns: ["Category", "Count"],
              data: data.categories.map((category) => [
                category.category,
                category.count.toLocaleString(),
              ]),
            }),
          ]),
        ]),
      ])
    },
  }
}

type StreamPageData = {
  event: ITimelineEvent | null
  state: any
  ignored: boolean
}

const loadStreamData = (stream_name: string) =>
  m.request<StreamPageData[]>(`http://localhost:3000/equinox-explorer/stream/${stream_name}`)

const EventCard: m.ClosureComponent<StreamPageData> = (vnode) => {
  const event = vnode.attrs.event
  const state = vnode.attrs.state
  const ignored = vnode.attrs.ignored
  const isInitial = !ignored && event == null
  const data = JSON.parse(event?.data ?? "{}")
  const meta = JSON.parse(event?.meta ?? "{}")
  const time = event ? new Date(event.time).toLocaleString() : null

  return {
    view() {
      return m("li.w-full.rounded.mt-8.bg-gray-50.dark:bg-gray-800", [
        m("div.px-6.py-4", [
          m(
            "h4.text-xl.text-gray-700.dark:text-gray-50",
            isInitial ? "Initial" : event?.type ?? "Unknown",
          ),
          m("hr"),
          time ? m("span.text-gray-700.dark:text-gray-50", time) : null,
          meta?.$correlationId
            ? m(
                "a.text-blue-500.dark:text-blue-400",
                { href: `#!/correlation/${meta.$correlationId}` },
                "See correlated events",
              )
            : null,
          m("section.grid.lg:grid-cols-3.gap-4.mt-4.md:grid-cols-2.sm:grid-cols-1", [
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
            m("div", [
              m("h5.text-lg.text-gray-700.dark:text-gray-50", "State"),
              state
                ? m("json-viewer.p-4", { data: state })
                : m("p.text-gray-700.dark:text-gray-50", "No state"),
            ]),
          ]),
        ]),
      ])
    },
  }
}

const StreamPage: m.ClosureComponent<{ stream_name: string }> = (vnode) => {
  let data: StreamPageData[] = []
  let isLoading = true

  loadStreamData(vnode.attrs.stream_name).then((x) => {
    isLoading = false
    data = x
  })

  return {
    view(vnode) {
      if (isLoading) return m("main.container.mx-auto.mt-8", "Loading...")

      return m("main.container.mx-auto.mt-8", [
        m("h1.text-3xl", ["Stream ", vnode.attrs.stream_name]),
        m("section", [m("ul", [data.map((x) => m(EventCard, x))])]),
      ])
    },
  }
}

const loadCorrelatedEvents = (correlationId: string) =>
  m.request<[StreamName, ITimelineEvent][]>(
    `http://localhost:3000/equinox-explorer/correlation/${correlationId}`,
  )

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

const CorrelationPage: m.ClosureComponent<{ correlation_id: string }> = (vnode) => {
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
      return m("main.container.mx-auto.mt-8", [
        m("h1.text-3xl", ["Correlation ", vnode.attrs.correlation_id]),
        correlations.length > 0
          ? m("section.mt-8", [
              m("h2.text-2xl", "Correlation tree"),
              m(CorrelationGraph, { correlations }),
            ])
          : null,

        m("section", [m("ul", [data.map((x) => m(BasicEventCard, { event: x }))])]),
      ])
    },
  }
}

const CorrelationTest: m.ClosureComponent = () => {
  const correlations = [
    {
      id: "1",
      causationId: "1",
      time: "2021-08-15T11:22:33.444Z",
      type: "VisitCompleted",
    },
    {
      id: "2",
      causationId: "1",
      time: "2021-08-16T11:22:34.444Z",
      type: "DistanceCalculationRequested",
    },
    {
      id: "3",
      causationId: "1",
      time: "2021-08-16T10:18:35.444Z",
      type: "VisitRated",
    },
    {
      id: "4",
      causationId: "2",
      time: "2021-08-16T11:22:36.444Z",
      type: "TravelEstimateRecorded",
    },
  ]

  return {
    view() {
      return m("main.container.mx-auto.mt-8", [
        m("h1.text-3xl", "Correlation test"),
        m(CorrelationGraph, {
          correlations,
        }),
      ])
    },
  }
}

m.route(document.body, "/", {
  "/": MainPage,
  "/stream/:stream_name": StreamPage,
  "/correlation/test": CorrelationTest,
  "/correlation/:correlation_id": CorrelationPage,
})
