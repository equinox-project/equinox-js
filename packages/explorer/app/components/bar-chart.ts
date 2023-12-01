import * as d3 from "d3"
import m from "mithril"
import { format, subDays } from "date-fns"
import { Tooltip } from "./tooltip"

type BarChartDatum = {
  x: string
  y: number
}

class D3BarChart {
  svg?: d3.Selection<SVGSVGElement, unknown, null, undefined>
  g?: d3.Selection<SVGGElement, unknown, null, undefined>
  _xAxis?: d3.ScaleBand<string>
  _yAxis?: d3.ScaleLinear<number, number, never>
  width?: number
  height?: number
  axisX: d3.Selection<SVGGElement, unknown, null, undefined> | undefined
  axisY: d3.Selection<SVGGElement, unknown, null, undefined> | undefined
  tooltip = new Tooltip()

  render(el: SVGSVGElement, data: BarChartDatum[]) {
    this.svg = d3.select(el)
    this.redraw(data)
  }

  xAxis() {
    return this._xAxis || (this._xAxis = d3.scaleBand())
  }

  yAxis() {
    return this._yAxis || (this._yAxis = d3.scaleLinear())
  }

  renderAxes() {
    if (!this.axisX) {
      this.axisX = this.g!.append("g").attr("transform", "translate(0," + this.height + ")")
    }
    if (!this.axisY) {
      this.axisY = this.g!.append("g")
    }
    this.axisX
      .call(d3.axisBottom(this.xAxis()))
      .selectAll("text")
      .attr("transform", "translate(-10,0)rotate(-45)")
      .style("text-anchor", "end")
    this.axisY.call(d3.axisLeft(this.yAxis()))
  }

  redraw(data: BarChartDatum[]) {
    if (!this.svg) return
    // set the dimensions and margins of the graph
    const margin = { top: 30, right: 30, bottom: 70, left: 60 }
    this.width = this.svg.node()!.parentElement!.offsetWidth - margin.left - margin.right
    this.height = this.svg.node()!.parentElement!.offsetHeight - margin.top - margin.bottom

    this.svg
      .attr("width", this.width + margin.left + margin.right)
      .attr("height", this.height + margin.top + margin.bottom)

    this.g =
      this.g ??
      this.svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")")

    const now = new Date()
    const xValues = d3.range(8).map((i) => format(subDays(now, 7 - i), "yyyy-MM-dd"))
    const x = this.xAxis().range([0, this.width]).domain(xValues).padding(0.2)
    const y = this.yAxis()
      .domain(d3.extent(data, (d) => d.y) as [number, number])
      .range([this.height, 0])

    this.renderAxes()
    const bars = this.g.selectAll("rect").data(data)
    bars.exit().remove()
    bars
      .enter()
      .append("rect")
      .attr("x", (d) => x(d.x)!)
      .attr("width", x.bandwidth())
      .attr("y", y(0))
      .attr("height", Math.max(0, this.height - y(0)))
      .attr("class", "fill-green-900 dark:fill-green-300")
      .on("mouseover", (ev, d) => {
        this.tooltip.html(`
         <div class="flex items-center justify-center bg-gray-300 dark:bg-gray-950 rounded px-4 py-2">
         <p>${d.y.toLocaleString()}</p>
         </div>`)

        this.tooltip.show(ev)
      })
      .on("mouseout", () => {
        this.tooltip.hide()
      })

    this.g
      .selectAll<d3.BaseType, BarChartDatum>("rect")
      .attr("width", x.bandwidth())
      .attr("x", (d) => x(d.x)!)
      .transition()
      .ease(d3.easeCubicOut)
      .duration(375)
      .attr("y", (d) => y(d.y))
      .attr("height", (d) => Math.max(0, this.height! - y(d.y)))
  }
  destroy() {
    this.tooltip.destroy()
  }
}

export const BarChart: m.ClosureComponent<{
  data: BarChartDatum[]
  height: number
}> = (vnode) => {
  const chart = new D3BarChart()
  let frame: number
  const rerender = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      chart.redraw(vnode.attrs.data)
    })
  }
  window.addEventListener("resize", rerender)
  return {
    onremove() {
      window.removeEventListener("resize", rerender)
      chart.destroy()
    },
    view(vnode) {
      const { data, height } = vnode.attrs
      return m(
        "div.chart-container.w-full.bg-white.dark:bg-gray-800",
        { style: { height: `${height}px` } },
        m("svg.chart", {
          onupdate(vnode) {
            chart.redraw(vnode.attrs.data)
          },
          oncreate: (vnode) => {
            chart.render(vnode.dom as SVGSVGElement, data)
          },
        }),
      )
    },
  }
}
