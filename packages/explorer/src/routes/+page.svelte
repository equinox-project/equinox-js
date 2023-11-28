<script>
	import BarChart from '$lib/components/BarChart.svelte'

	/** @type {import('./$types').PageData} */
	export let data
</script>

<main class="mt-12 container mx-auto">
	<h1 class="text-2xl">Welcome to Equinox Explorer</h1>

	<div class="grid grid-cols-3 mt-4">
		<section>
			<h3 class="text-xl">Recent Streams</h3>

			<ul>
				{#each data.streams as stream}
					<li>
						<a class="text-blue-600" href="/stream/{stream.stream_name}">{stream.stream_name}</a>
					</li>
				{/each}
			</ul>
		</section>

		<section>
			<h3 class="text-xl">Events in the past 7 days</h3>

      <BarChart data={data.events || []} xAccessor="date" yAccessor="count" />
		</section>
	</div>
</main>
