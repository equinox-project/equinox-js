import { pool } from "$lib/context"

export async function load() {
	const streamsP = pool.query(
		"SELECT stream_name FROM messages order by global_position desc limit 20"
	)
	const eventsP = pool.query(
		`select time::date::text as date, count(*) 
     from messages 
     where time > now() - interval '14 days' 
     group by date 
     order by date asc`
	)
  const [streams, events] = await Promise.all([streamsP, eventsP])
  console.log(streams.rows, events.rows)
	return { streams: streams.rows, events: events.rows}
}
