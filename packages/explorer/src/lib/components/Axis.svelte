<script>
	import { browser } from "$app/environment"
	import { select } from "d3-selection"
	export let axis
	let elem
	$: if (elem && browser) {
		select(elem).call(axis)
	}
	export let transform = ""
</script>

<g bind:this={elem} {transform}></g>
