<script>
	import { scaleLinear, scaleUtc } from "d3-scale"
	import { extent, max } from "d3-array"
	import Axis from "./Axis.svelte"
	import { axisBottom, axisLeft } from "d3-axis"
	import { onMount } from "svelte"

	export let data
	export let xAccessor
	export let yAccessor

	let width = 800
	let height = 400 

	const margin = { top: 20, right: 20, bottom: 20, left: 40}
	$: innerHeight = height - margin.top - margin.bottom
	$: innerWidth = width - margin.left - margin.right


	$: xExtent = extent(data, (d) => new Date(d[xAccessor]))
	$: yMax = max(data, (d) => +d[yAccessor])

  let yScale = scaleLinear()
  $: yScale = yScale.domain([0, yMax]).range([innerHeight, 0])
  let xScale = scaleUtc()
  $: xScale = xScale.domain(xExtent).range([10, innerWidth - 10])


  $: console.log(xScale.range())

  /** @type {SVGSVGElement} */
  let svg

  onMount(() => {
    function setWidth() {
      width = svg.parentElement?.offsetWidth || width
      if (!svg) return
    }
    setWidth()
    window.addEventListener("resize", setWidth)
    return () => window.removeEventListener("resize", setWidth)
  })

</script>

<svg {width} {height} bind:this={svg}>
	<g transform={`translate(${margin.left}, ${margin.top})`}>
		<Axis axis={axisLeft(yScale)} />
		<Axis axis={axisBottom(xScale).tickSizeOuter(0)} transform={`translate(0, ${innerHeight})`}
		></Axis>

		{#each data as d}
			<rect
				x={xScale(new Date(d[xAccessor])) - 10 }
				y={yScale(+d[yAccessor])}
				width={20}
				height={innerHeight - yScale(+d[yAccessor])}
				fill="steelblue"
			/>
		{/each}
	</g>
</svg>
