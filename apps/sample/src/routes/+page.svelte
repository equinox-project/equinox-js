<script>
  /** @type {import('./$types').PageData} */
  export let data
</script>

<h1>Todos</h1>

<form method="POST" action="?/create">
  <input type="text" name="title" />
  <input type="submit" />
  <button formaction="?/clear">Clear</button>
</form>

<ul>
  {#each data.todos as t (t.id)}
    <li>
      {t.title} ({t.completed ? "Complete" : "Incomplete"})
      <form method="POST" action="?/complete">
        <input type="hidden" name="todoId" value={t.id} />
        <button type="submit">✅</button>
        <button formaction="?/remove">❌</button>
      </form>
    </li>
  {/each}
</ul>
