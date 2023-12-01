import * as d3 from "d3"
let id = 0
export class Tooltip {
  id: string
  class: string
  el: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>
  constructor() {
    this.id = "d3-tooltip-" + id++
    this.class = "d3-tooltip"
    this.el = d3
      .select("body")
      .append("div")
      .attr("id", this.id)
      .attr("class", this.class)
      .style("opacity", 0)
      .style("position", "absolute")
      .style("pointer-events", "none")
  }

  destroy() {
    this.el.remove()
  }

  html(html: string) {
    this.el.html(html)
  }

  show(ev: MouseEvent) {
    this.el.style("left", ev.pageX + 10 + "px").style("top", ev.pageY - 28 + "px")
    this.el
      .transition()
      .duration(200)
      .style("opacity", 1)
  }

  hide() {
    this.el.transition().duration(200).style("opacity", 0)
  }
}
