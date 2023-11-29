import * as d3 from "d3"
import m from "mithril"

type BarChartDatum = {
  x: string
  y: number
}

function renderTo(svgEl: SVGSVGElement, data: BarChartDatum[]) {
  // set the dimensions and margins of the graph
  const margin = { top: 30, right: 30, bottom: 70, left: 60 }
  const width = svgEl.parentElement!.offsetWidth - margin.left - margin.right
  const height = svgEl.parentElement!.offsetHeight - margin.top - margin.bottom

  // append the svg object to the body of the page
  const svg = d3
    .select(svgEl)
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)

    .append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")")

  const x = d3
    .scaleBand()
    .range([0, width])
    .domain(data.map((d) => d.x))
    .padding(0.2)

  svg
    .append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("transform", "translate(-10,0)rotate(-45)")
    .style("text-anchor", "end")

  // Add Y axis
  var y = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.y) as [number, number])
    .range([height, 0])
  svg.append("g").call(d3.axisLeft(y))

  // Bars
  svg
    .selectAll("mybar")
    .data(data)
    .enter()
    .append("rect")
    .attr("x", (d) => x(d.x)!)
    .attr("y", (d) => y(d.y))
    .attr("width", x.bandwidth())
    .attr("height", (d) => height - y(d.y))
    .attr("class", "fill-green-900 dark:fill-green-300")
    .append("title")
    .text((d) => d.y.toLocaleString())
}

function rerender(svg: SVGSVGElement, data: BarChartDatum[]) {
  d3.select(svg).select("g").remove()
  renderTo(svg, data)
}

export const BarChart: m.ClosureComponent<{
  data: BarChartDatum[]
  height: number
}> = () => {
  return {
    view(vnode) {
      const { data, height } = vnode.attrs
      return m(
        "div.chart-container.w-full.bg-white.dark:bg-gray-800",
        { style: { height: `${height}px` } },
        m("svg.chart", {
          onupdate(vnode) {
            const el = vnode.dom as SVGSVGElement
            rerender(el, data)
          },
          oncreate: (vnode) => {
            const el = vnode.dom as SVGSVGElement
            renderTo(el, data)
          },
        }),
      )
    },
  }
}
