<script>
  import {enhance} from "$app/forms"
  import {fly} from 'svelte/transition'
  import {flip} from 'svelte/animate'

  /** @type {import('./$types').PageData} */
  export let data
</script>

<h1>Todos</h1>

<form method="POST" action="?/create" use:enhance>
  <input type="text" name="title" autofocus />
  <input type="submit" />
  <button formaction="?/clear">Clear</button>
</form>

<ul>
  {#each data.todos as t (t.id)}
    <li transition:fly={{y: -15}} animate:flip>
      {t.title} ({t.completed ? "Complete" : "Incomplete"})
      <form method="POST" action="?/complete" use:enhance>
        <input type="hidden" name="todoId" value={t.id} />
        <button type="submit">✅</button>
        <button formaction="?/remove">❌</button>
      </form>
    </li>
  {/each}
</ul>
