import m from "mithril"
import logo from "../../../../docs/static/img/Equinox-favicon.png"

export const Navbar: m.Component = {
  view(vnode) {
    const activeRoute = m.route.get()
    const activeStyle =
      "text-blue-600 border-b-2 border-blue-600 rounded-t-lg active dark:text-blue-500 dark:border-blue-500 group"
    return m(
      ".flex.text-sm.font-medium.text-center.text-gray-500.border-b.border-gray-200.dark:text-gray-400.dark:border-gray-700",
      [
        m("a.flex.justify-center.items-center.ml-4.py-2", { href: "#!/" }, [
          m("img.h-8.py-auto.w-auto", { src: logo }),
        ]),
        m("ul.flex.flex-wrap.-mb-px", [
          m("li.me-2", [
            m(
              "a.inline-block.p-4.border-b-2.border-transparent.rounded-t-lg.hover:text-gray-600.hover:border-gray-300.dark:hover:text-gray-300",
              { href: "#!/", class: activeRoute === "/" ? activeStyle : "" },
              "Home",
            ),
          ]),
        ]),
        m(".flex.ml-auto.mr-4.items-center", [
          m(
            "input.h-5bg-gray-50.border.border-gray-300.text-gray-900.text-sm.rounded-lg.focus:ring-blue-500.focus:border-blue-500.block.w-full.p-2.5.dark:bg-gray-700.dark:border-gray-600.dark:placeholder-gray-400.dark:text-white.dark:focus:ring-blue-500.dark:focus:border-blue-500",
            {
              placeholder: "Go to stream",
              onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  m.route.set(`/stream/${(e.target as HTMLInputElement).value}`)
                }
              },
            },
          ),
        ]),
      ],
    )
  },
}
