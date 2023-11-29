import m from "mithril"
import * as d3 from "d3"

type Correlation = {
  id: string
  causationId: string
  time: string
  type: string
  streamName: string
}

function renderTree(width: number, data: Correlation[]) {
  const padding = 1
  const root = d3
    .stratify<Correlation>()
    .parentId((d) => (d.causationId === d.id ? null : d.causationId))
    .id((d) => d.id)(data)

  const descendants = root.descendants()

  const L = descendants.map((d) => d.data.type)

  const dx = 100
  const dy = width / (root.height + padding)

  const treeRoot = d3.tree<Correlation>().nodeSize([dx, dy])(root)

  let x0 = Infinity
  let x1 = -x0

  treeRoot.each((d) => {
    if (d.x > x1) x1 = d.x
    if (d.x < x0) x0 = d.x
  })

  const height = x1 - x0 + dx * 2

  const svg = d3
    .create("svg")
    .attr("viewBox", [(-dy * padding) / 2, x0 - dx, width, height])
    .attr("width", width)
    .attr("height", height)
    .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
    .attr("font-family", "sans-serif")
    .attr("font-size", 16)

  const strokeOpacity = 0.4
  const strokeLinecap = "round"
  const strokeLinejoin = "round"
  const strokeWidth = 1.5

  const haloWidth = 5
  const r = 6

  svg
    .append("g")
    .attr("fill", "none")
    .attr("class", "stroke-gray-900 dark:stroke-gray-50")
    .attr("stroke-opacity", strokeOpacity)
    .attr("stroke-linecap", strokeLinecap)
    .attr("stroke-linejoin", strokeLinejoin)
    .attr("stroke-width", strokeWidth)
    .selectAll("path")
    .data(root.links())
    .join("path")
    .attr(
      "d",
      // @ts-ignore
      d3
        .link(d3.curveBumpX)
        // @ts-ignore
        .x((d) => d.y)
        // @ts-ignore
        .y((d) => d.x),
    )

  const node = svg
    .append("g")
    .selectAll("a")
    .data(root.descendants())
    .join("a")
    .attr("xlink:href", (d) => `#!/stream/${d.data.streamName}`)
    // @ts-ignore
    .attr("transform", (d) => `translate(${d.y},${d.x})`)

  node.append("title").text((d) => d.data.streamName)

  node
    .append("circle")
    .attr("class", "stroke-gray-900 dark:stroke-gray-50 fill-gray-50 dark:fill-gray-900")
    .attr("r", r)

  node
    .append("text")
    .attr("dy", "0.32em")
    .attr("x", (d) => (d.children ? -(2 + r) : r + 2))
    .attr("text-anchor", (d) => (d.children ? "end" : "start"))
    .attr("paint-order", "stroke")
    .attr("class", "stroke-gray-50 dark:stroke-gray-900 fill-gray-900 dark:fill-gray-50")
    .attr("stroke-width", haloWidth)
    .text((_d, i) => L[i])

  return svg.node()
}

export const CorrelationGraph: m.ClosureComponent<{
  correlations: Correlation[]
}> = () => {
  return {
    oncreate(vnode) {
      const dom = vnode.dom as HTMLDivElement
      const svg = renderTree(dom.offsetWidth, vnode.attrs.correlations)
      if (svg) vnode.dom.appendChild(svg)
    },
    view() {
      return m(
        "div.chart-container.border.border-black.border-solid.rounded.bg-white.dark:bg-gray-800",
      )
    },
  }
}
