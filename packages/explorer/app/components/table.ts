import m from "mithril"

export const Table: m.Component<{ columns: string[]; data: m.Child[][] }> = {
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
