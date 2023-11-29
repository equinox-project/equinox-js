import { Handler, Request, Router } from "express"
import { ICodec, ITimelineEvent, StreamName } from "@equinox-js/core"
import { subDays, startOfDay, endOfDay } from "date-fns"
import { type Pool } from "pg"
import { MessageDbConnection } from "@equinox-js/message-db"

interface Fold<E, S> {
  initial: S
  fold(state: S, events: E[]): S
}

interface EventContext {
  readStream(streamName: string): AsyncIterable<ITimelineEvent[]>
  readCorrelatedEvents(correlationId: string): AsyncIterable<[StreamName, ITimelineEvent][]>
}

interface StatsContext {
  recentStreams(): Promise<string[]>
  eventsInPeriod(from: Date, to: Date): Promise<{ date: string; count: number }[]>
  eventsByCategory(): Promise<{ category: string; count: number }[]>
}

interface Category<E, S, C> {
  name: string
  codec: ICodec<E, string, C>
  fold: Fold<E, S>
}

interface Options {
  context: EventContext
  stats: StatsContext
  categories: Category<any, any, any>[]
}

class MessageDbEventContext {
  private client: MessageDbConnection
  constructor(pool: Pool) {
    this.client = MessageDbConnection.create(pool)
  }

  async *readStream(streamName: string): AsyncIterable<ITimelineEvent[]> {
    let position = 0n
    while (true) {
      const events = await this.client.read.readStream(streamName, position, 500, false)
      yield events
      if (events.length < 500) return
      position = events[events.length - 1].index
    }
  }

  async *readCorrelatedEvents(
    correlationId: string,
  ): AsyncIterable<[StreamName, ITimelineEvent][]> {
    let position = 0n
    while (true) {
      const events = await this.client.read.readCorrelatedEvents(correlationId, position, 500)
      yield events
      if (events.length < 500) return
      position = events[events.length - 1][1].index
    }
  }
}

class MessageDbStatsContext {
  constructor(private readonly pool: Pool) {}

  async recentStreams(): Promise<string[]> {
    const result = await this.pool.query({
      text: `select stream_name, time from messages 
        order by global_position desc
        limit 20`,
    })
    return result.rows
  }

  async eventsInPeriod(from: Date, to: Date): Promise<{ date: string; count: number }[]> {
    const result = await this.pool.query({
      text: `select time::date::text as date, count(*) from messages 
        where time between $1 and $2
        group by date
        order by date`,
      values: [from, to],
    })
    return result.rows
  }

  async eventsByCategory(): Promise<{ category: string; count: number }[]> {
    const result = await this.pool.query({
      text: `select category(stream_name) as category, count(*) from messages 
        group by category
        order by count desc`,
    })
    return result.rows
  }
}

export function createMessageDbContexts(pool: Pool) {
  return {
    context: new MessageDbEventContext(pool),
    stats: new MessageDbStatsContext(pool),
  }
}

export function createExplorerMiddleware(options: Options): Handler {
  const router = Router()

  router.get(
    "/events-by-category",
    handle(async () => {
      const categories = await options.stats.eventsByCategory()
      return categories
    }),
  )

  router.get(
    "/events-by-day",
    handle(async () => {
      const now = new Date()
      const start = startOfDay(subDays(now, 7))
      const end = endOfDay(now) // clock drift?
      const events = await options.stats.eventsInPeriod(start, end)
      return events
    }),
  )

  router.get(
    "/recent-streams",
    handle(async () => {
      const streams = await options.stats.recentStreams()
      return streams
    }),
  )

  router.get(
    "/stream/:stream_name",
    handle(async (req) => {
      const streamName = req.params.stream_name
      const categoryName = StreamName.category(StreamName.parse(streamName))
      const category = options.categories.find((x) => x.name === categoryName)

      if (!category) return null

      const states = [{ event: null as any, state: category.fold.initial, ignored: false }]
      let state = category.fold.initial
      for await (const events of options.context.readStream(streamName)) {
        for (const raw of events) {
          const event = category.codec.decode(raw)
          const safe = {
            id: raw.id,
            meta: raw.meta,
            data: raw.data,
            index: raw.index.toString(),
            isUnfold: raw.isUnfold,
            time: raw.time,
            type: raw.type,
            size: raw.size,
          }

          if (!event) {
            states.push({ event: safe, state, ignored: true })
            continue
          }
          state = category.fold.fold(state, [event])
          states.push({ event: safe, state, ignored: false })
        }
      }
      return states
    }),
  )

  router.get(
    "/correlation/:correlation_id",
    handle(async (req) => {
      const correlationId = req.params.correlation_id
      const events = []
      for await (const raw of options.context.readCorrelatedEvents(correlationId)) {
        events.push(raw)
      }

      return events.flat().map(([sn, raw]) => [
        sn,
        {
          id: raw.id,
          meta: raw.meta,
          data: raw.data,
          index: raw.index.toString(),
          isUnfold: raw.isUnfold,
          time: raw.time,
          type: raw.type,
          size: raw.size,
        },
      ])
    }),
  )
  return router
}

function handle(fn: (req: Request) => Promise<any>): Handler {
  return (req, res, next) => {
    fn(req)
      .then((x) => {
        res.json(x)
      })
      .catch(next)
  }
}
