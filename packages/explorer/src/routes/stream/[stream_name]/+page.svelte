<script>
	import { Timeline, TimelineItem, Activity, ActivityItem, Group, GroupItem } from "flowbite-svelte"
	/** @type {import('./$types').PageData} */
	export let data
</script>

<main class="container mx-auto pt-6">
	<h1 class="text-3xl w-full">
		Stream "{data.stream_name}"
	</h1>

	<Timeline class="mt-8">
		{#each data.events as event (event.id)}
			<TimelineItem title={event.type} date={new Date(event.time).toLocaleString()}>
				<pre><code>{event.data}</code></pre>
			</TimelineItem>
		{/each}
	</Timeline>
</main>
