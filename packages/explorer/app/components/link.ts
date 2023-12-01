import m from "mithril"
export const Link: m.Component<m.Attributes & { href: string }> = {
  view(vnode) {
    return m(
      "a.font-medium.text-blue-600.dark:text-blue-500.hover:underline",
      vnode.attrs,
      vnode.children,
    )
  },
}
