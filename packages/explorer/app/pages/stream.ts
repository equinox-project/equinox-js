import m from "mithril"
import { StreamEvent, StreamPageData, loadStreamPageData } from "../data-access/data-access"
import { EventTimeline } from "../components/stream-plot"
import { Link } from "../components/link"
import { Navbar } from "../layout/navbar"

const EventTypeList: m.Component<{
  events: StreamEvent[]
  streamName: string
  onselect: (event: StreamEvent | null) => void
  selectedEvent: StreamEvent | null
}> = {
  view(vnode) {
    return m("ol.relative.border-s.border-gray-200.dark:border-gray-700.ml-2", [
      m("li.mb-2.ms-4", [
        m("", {
          class:
            "absolute w-3 h-3 bg-gray-200 rounded-full mt-1.5 -start-1.5 border border-white dark:border-gray-900 dark:bg-gray-700" +
            (vnode.attrs.selectedEvent == null ? " bg-green-700 dark:bg-green-500" : ""),
        }),
        m("time.mb-1.text-sm.font-normal.leading-none.text-gray-400.dark:text-gray-500", "Initial"),
        m(
          "a",
          {
            href: `#!/stream/${vnode.attrs.streamName}`,
            onclick: () => {
              vnode.attrs.onselect(null)
            },
          },
          m("h3.text-lg.font-semibold.text-gray-900.dark:text-white", "Initial"),
        ),
      ]),
      vnode.attrs.events.map((ev) => {
        if (!ev.id) console.log(ev)
        return m("li.mb-2.ms-4", { key: ev.id }, [
          m("", {
            class:
              "absolute w-3 h-3 bg-gray-200 rounded-full mt-1.5 -start-1.5 border border-white dark:border-gray-900 dark:bg-gray-700" +
              (vnode.attrs.selectedEvent?.id === ev.id ? " bg-green-700 dark:bg-green-500" : ""),
          }),
          m(
            "time.mb-1.text-sm.font-normal.leading-none.text-gray-400.dark:text-gray-500",
            new Date(ev.time).toLocaleString(),
          ),
          m(
            "a",
            {
              href: `#!/stream/${vnode.attrs.streamName}?event=${ev.id}`,
              onclick: () => {
                vnode.attrs.onselect(ev)
              },
            },
            m("h3.text-lg.font-semibold.text-gray-900.dark:text-white", ev.type),
          ),
        ])
      }),
    ])
  },
}

const EventDetails: m.Component<{ event: StreamEvent }> = {
  view(vnode) {
    const ev = vnode.attrs.event
    return [
      m("section.flex.flex-col", [
        m("", [m("h5.text-md", "Type"), m("p.text-sm.text-gray-700.dark:text-gray-50", ev.type)]),

        m(".mt-2", [
          m("h5.text-md", "Time"),
          m("p.text-sm.text-gray-700.dark:text-gray-50", new Date(ev.time).toLocaleString()),
        ]),
        m(".mt-2", [
          m("h5.text-md", "Index"),
          m("p.text-sm.text-gray-700.dark:text-gray-50", String(ev.index)),
        ]),
        m(".mt-2", [m("h5.text-md", "ID"), m("p.text-sm.text-gray-700.dark:text-gray-50", ev.id)]),
        ev?.meta?.$correlationId
          ? m(".mt-2", [
              m("h5.text-md", "Correlation ID"),
              m(
                Link,
                {
                  href: "#!/correlation/" + ev.meta.$correlationId,
                  class: "text-sm",
                },
                ev.meta.$correlationId,
              ),
            ])
          : null,
        ev?.meta?.$causationId
          ? m(".mt-2", [
              m("h5.text-md", "Causation ID"),
              m("p.text-sm.text-gray-700.dark:text-gray-50", ev.meta.$causationId),
            ])
          : null,

        m(".mt-2", [
          m("h5.text-md", "Data"),
          ev?.data
            ? m("json-viewer.p-4", { data: ev.data })
            : m("p.text-gray-700.dark:text-gray-50", "No data"),
        ]),
        m(".mt-2", [
          m("h5.text-md", "Meta"),
          ev?.meta
            ? m("json-viewer.p-4", { data: ev.meta })
            : m("p.text-gray-700.dark:text-gray-50", "No meta"),
        ]),
      ]),
    ]
  },
}

export const StreamPage: m.ClosureComponent<{ stream_name: string }> = (vnode) => {
  let data: StreamPageData = { initial: undefined, events: [] }
  let isLoading = true
  let selectedEvent: StreamEvent | null = null
  let initialSelectedEvent = m.route.param("event")

  loadStreamPageData(vnode.attrs.stream_name).then((xs) => {
    isLoading = false
    data = xs
    if (initialSelectedEvent) {
      selectedEvent = xs.events.find((x) => x.id === initialSelectedEvent) ?? null
    } else {
      selectedEvent = xs.events[xs.events.length - 1]
    }
  })

  let frame: number
  const hashChangeHandler = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      initialSelectedEvent = m.route.param("event")
      selectedEvent = data.events.find((x) => x.id === initialSelectedEvent) ?? null
      m.redraw()
    })
  }
  window.addEventListener("hashchange", hashChangeHandler)

  return {
    onremove() {
      window.removeEventListener("hashchange", hashChangeHandler)
    },
    view(vnode) {
      if (isLoading) return [m(Navbar), m("main.container.mx-auto.mt-8", "Loading...")]

      return [
        m(
          "main.grid.grid-cols-3.gap-1.dark:bg-gray-900.h-screen.max-h-screen",
          {
            class: "grid-rows-[auto_auto_auto_1fr]",
          },
          [
            m("div.col-span-3", m(Navbar)),
            m("h1.text-3xl.col-span-3.mt-8.mb-4.ml-4", ["Stream ", vnode.attrs.stream_name]),
            m("section.mt-4.col-span-3", [
              m(EventTimeline, {
                data: data.events,
                height: 100,
                onselect: (ev) => {
                  selectedEvent = ev
                  m.route.set(`/stream/${vnode.attrs.stream_name}?event=${ev.id}`)
                },
              }),
            ]),
            m(".flex.flex-col.dark:bg-gray-800.px-1.py-6.flex-1.max-h-full.min-h-0", [
              m("h3.text-xl.mb-4.ml-3", "Events"),
              m(".overflow-y-auto.min-h-0", [
                m(EventTypeList, {
                  events: data.events,
                  selectedEvent,
                  streamName: vnode.attrs.stream_name,
                  onselect: (ev) => {
                    selectedEvent = ev ?? null
                  },
                }),
              ]),
            ]),
            m(".dark:bg-gray-800.px-4.py-6.col-span-2.overflow-y-auto", [
              m("h3.text-xl.mb-4", "State"),
              selectedEvent
                ? m("json-viewer.p-4", {
                    data: selectedEvent.state,
                  })
                : m("json-viewer.p-4", {
                    data: data.initial,
                  }),

              m("h3.text-xl.my-4", "Event"),
              selectedEvent
                ? m(EventDetails, { event: selectedEvent })
                : m("p.text-gray-700.dark:text-gray-50", "No event selected"),
            ]),
          ],
        ),
      ]
    },
  }
}
