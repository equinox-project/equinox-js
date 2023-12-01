import * as d3 from "d3"
import m from "mithril"
import { Tooltip } from "./tooltip"
import { StreamEvent } from "../data-access/data-access"

class EventTimelineChart {
  tooltip: Tooltip
  svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>
  g!: d3.Selection<SVGGElement, unknown, null, undefined>
  width!: number
  height!: number
  _xAxis?: d3.ScaleTime<number, number, never>
  axis?: d3.Selection<SVGGElement, unknown, null, undefined>

  constructor(private onSelect?: (ev: StreamEvent) => void) {
    this.tooltip = new Tooltip()
  }

  margin = { top: 30, right: 30, bottom: 30, left: 60 }

  render(el: SVGSVGElement, data: StreamEvent[]) {
    this.svg = d3.select(el)

    this.redraw(data)
  }

  xAxis() {
    if (!this._xAxis) {
      this._xAxis = d3.scaleUtc()
    }
    return this._xAxis
  }

  renderAxis() {
    if (!this.axis) {
      this.axis = this.g.append("g").attr("transform", "translate(0," + this.height + ")")
    }
    this.axis.call(d3.axisBottom(this.xAxis()))
  }

  redraw(data: StreamEvent[]) {
    // set the dimensions and margins of the graph
    const totalHeight = this.svg.node()!.parentElement!.offsetHeight
    const totalWidth = this.svg.node()!.parentElement!.offsetWidth
    const margin = this.margin
    this.width = totalWidth - margin.left - margin.right
    this.height = totalHeight - margin.top - margin.bottom

    this.svg
      .attr("width", this.width + margin.left + margin.right)
      .attr("height", this.height + margin.top + margin.bottom)
    this.g =
      this.g ??
      this.svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")")

    const x = this.xAxis()
      .range([0, this.width])
      .domain(d3.extent(data, (d) => new Date(d.time)) as [Date, Date])

    this.renderAxis()

    // circles
    const circles = this.g.selectAll("circle").data(data)
    circles.exit().remove()
    circles
      .enter()
      .append("circle")
      .attr("r", 5)
      .attr("fill-opacity", 0.7)
      .attr("class", "fill-green-900 dark:fill-green-300")
      .on("mouseover", (ev, d) => {
        this.tooltip.html(`
         <div class="flex items-center justify-center bg-gray-300 dark:bg-gray-950 rounded px-4 py-2">
         <p>${d.type}</p>
         </div>`)
        this.tooltip.show(ev)
      })
      .on("mouseout", () => {
        this.tooltip.hide()
      })
      .on("click", (_ev, d) => {
        this.onSelect?.(d)
      })
      // @ts-ignore
      .merge(circles)
      .attr("cx", (d) => x(new Date(d.time))!)
      .attr("cy", this.height / 2)
  }

  destroy() {
    this.tooltip.destroy()
  }
}

export const EventTimeline: m.ClosureComponent<{
  data: StreamEvent[]
  height: number
  onselect?: (ev: StreamEvent) => void
}> = (vnode) => {
  const chart = new EventTimelineChart(vnode.attrs.onselect)
  const redraw = () => {
    requestAnimationFrame(() => {
      chart.redraw(vnode.attrs.data)
    })
  }
  window.addEventListener("resize", redraw)
  return {
    onremove() {
      window.removeEventListener("resize", redraw)
      chart.destroy()
    },
    view(vnode) {
      const { data, height } = vnode.attrs
      return m(
        "div.chart-container.w-full.bg-white.dark:bg-gray-800",
        { style: { height: `${height}px` } },
        m("svg.chart", {
          onupdate() {
            chart.redraw(data)
          },
          oncreate: (vnode) => {
            const el = vnode.dom as SVGSVGElement
            chart.render(el, data)
          },
        }),
      )
    },
  }
}
