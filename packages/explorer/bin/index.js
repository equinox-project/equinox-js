const { StreamName } = require("@equinox-js/core")
const express = require("express")
const { subDays, startOfDay, endOfDay } = require("date-fns")
const { Pool } = require("pg")
const { MessageDbConnection } = require("@equinox-js/message-db")
const { Command } = require("commander")

class MessageDbEventContext {
  constructor(pool) {
    this.client = MessageDbConnection.create(pool)
  }

  async readStream(streamName) {
    let position = 0n
    const allEvents = []
    while (true) {
      const events = await this.client.read.readStream(streamName, position, 500, false)
      allEvents.push(events)
      if (events.length < 500) break
      position = events[events.length - 1].index
    }
    return allEvents.flat()
  }

  async readCorrelatedEvents(correlationId) {
    let position = 0n
    const allEvents = []
    while (true) {
      const events = await this.client.read.readCorrelatedEvents(correlationId, position, 500)
      allEvents.push(events)
      if (events.length < 500) break
      position = events[events.length - 1][1].index
    }

    return allEvents.flat()
  }
}

class MessageDbStatsContext {
  constructor(pool) {
    this.pool = pool
  }

  async recentStreams(category) {
    const params = []
    if (category) params.push(category)
    const result = await this.pool.query(
      `select stream_name, time from messages 
       ${category ? "where category(stream_name) = $1" : ""}
       order by global_position desc
       limit 20`,
      params,
    )
    return result.rows
  }

  async eventsInPeriod(from, to, category) {
    const params = [from, to]
    if (category) params.push(category)
    const result = await this.pool.query(
      `select time::date::text as date, count(*) from messages 
        where time between $1 and $2
        ${category ? "and category(stream_name) = $3" : ""}
        group by date
        order by date`,
      params,
    )
    console.log(result.rows)
    return result.rows
  }

  async eventsByCategory() {
    const result = await this.pool.query({
      text: `select category(stream_name) as category, count(*) from messages 
        group by category
        order by count desc`,
    })
    return result.rows
  }
}

function createMessageDbContexts(pool) {
  return {
    context: new MessageDbEventContext(pool),
    stats: new MessageDbStatsContext(pool),
  }
}

function createExplorerMiddleware(options) {
  const router = express.Router()

  router.get(
    "/events-by-category",
    handle(async () => {
      const categories = await options.stats.eventsByCategory()
      return categories
    }),
  )

  router.get(
    "/events-by-day",
    handle(async (req) => {
      const now = new Date()
      const start = startOfDay(subDays(now, 7))
      const end = endOfDay(now) // clock drift?
      const events = await options.stats.eventsInPeriod(start, end, req.query.category)
      return events
    }),
  )

  router.get(
    "/recent-streams",
    handle(async (req) => {
      const streams = await options.stats.recentStreams(req.query.category)
      return streams
    }),
  )

  router.get(
    "/stream/:stream_name",
    handle(async (req) => {
      const streamName = req.params.stream_name
      const categoryName = StreamName.category(StreamName.parse(streamName))
      const category = options.categories.find((x) => x.name === categoryName)

      let state = category?.fold.initial
      const events = []
      const streamEvents = await options.context.readStream(streamName)
      for (const raw of streamEvents) {
        let decoded = false
        if (category) {
          const event = category.codec.decode(raw)
          state = event ? category.fold.fold(state, [event]) : state
          decoded = !!event
        }
        const safe = {
          id: raw.id,
          meta: raw.meta ? JSON.parse(raw.meta) : undefined,
          data: raw.data ? JSON.parse(raw.data) : undefined,
          index: raw.index.toString(),
          isUnfold: raw.isUnfold,
          time: raw.time,
          type: raw.type,
          size: raw.size,
          state,
          decodable: decoded,
        }
        events.push(safe)
      }
      return { initial: category?.fold.initial, events }
    }),
  )

  router.get(
    "/correlation/:correlation_id",
    handle(async (req) => {
      const correlationId = req.params.correlation_id
      const events = await options.context.readCorrelatedEvents(correlationId)

      return events.map(([sn, raw]) => [
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

function handle(fn) {
  return (req, res, next) => {
    fn(req)
      .then((x) => {
        res.json(x)
      })
      .catch(next)
  }
}

const program = new Command()

program.name("eqx-explorer").version("0.0.1").description("Equinox Explorer")
program
  .option("-cs, --connection-string <connection-string>")
  .requiredOption("-c, --config <config-file>")
  .option("-p, --port <port>", "port to listen on", "3000")
  .action(async (options) => {
    const pool = new Pool({
      connectionString: options.connectionString || process.env.CONNECTION_STRING,
      max: 10,
    })
    const contexts = createMessageDbContexts(pool)
    const path = require("path")
    const esbuild = require("esbuild")
    const configPath = path.resolve(process.cwd(), options.config)
    const configSha = require("crypto").createHash("sha1").update(configPath).digest("hex")
    const compiledPath = `/tmp/eqx-explorer-${configSha}.js`
    console.log("Building config...")
    esbuild.buildSync({
      entryPoints: [configPath],
      bundle: true,
      minify: false,
      sourcemap: true,
      outfile: compiledPath,
      platform: "node",
      packages: "external",
    })
    const config = require(compiledPath)
    const app = require("express")()
    app.use(require("cors")({ origin: "*" }))
    app.use(express.static(path.resolve(__dirname, "../dist")))
    app.use((req, res, next) => {
      const now = process.hrtime.bigint()
      console.log(req.method, req.url)
      res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - now) / 1000000
        console.log(req.method, req.url, res.statusCode, `${ms.toFixed(2)}ms`)
      })
      next()
    })
    app.use("/api", createExplorerMiddleware({ ...contexts, ...config }))
    const port = Number(options.port || 3000)
    app.listen(port, () => {
      console.log("listening on port " + port)
    })
  })

program.parseAsync(process.argv)
