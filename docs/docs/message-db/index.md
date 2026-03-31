---
sidebar_position: 5
---

# MessageDB

MessageDB is a fully-featured event store and message store implemented in PostgreSQL for Pub/Sub, Event Sourcing,
Messaging, and Evented Microservices applications. It was extracted from
the [Eventide Project](http://docs.eventide-project.org/) to make it easier for users to write clients in the language
of their choosing.

Within EquinoxJS, MessageDB is the PostgreSQL option for production systems that
want a stream store with clear category semantics. It pairs well with the
Equinox service model because the domain stays storage-agnostic while read
models, reactions and access strategies can still be tuned explicitly.

If your default instinct is "we already run Postgres", this is the page to look
at first. MessageDB gives EquinoxJS a straightforward PostgreSQL deployment
story without pretending a generic events table and a stream store are the same
thing.

Use MessageDB when you want:

- PostgreSQL as the operational substrate
- category-based consumers and checkpoints
- store-supported inline projections when needed
- a mature stream-store model rather than a generic event table

The companion docs cover both [reactions](/docs/reactions) and
[inline projections](/docs/message-db/inline-projections),
which together cover the main PostgreSQL read-model shapes teams tend to need.

# Installing

## MessageDB installer

MessageDB offers its [own installer](http://docs.eventide-project.org/user-guide/message-db/install.html),
it can be used as such

```sh
$ export PGHOST=localhost
$ export PGPORT=5432
$ export PGUSER=postgres
$ export MDB_VERSION=1.3.0
$ mkdir -p /tmp/mdb
$ curl -sL -o /tmp/message_db.tar.gz https://github.com/message-db/message-db/archive/refs/tags/v$MDB_VERSION.tar.gz
$ tar -xf /tmp/message_db.tar.gz --directory /tmp/mdb
$ (cd /tmp/mdb/message-db-$MDB_VERSION/database && ./install.sh)
```

## pg-migrations

While this can work well it's not particularly great to use in IaC scenarios as
the installer is not idempotent. To combat this we offer a set of migrations you
can use with `@databases/pg-migrations`.

```sh
$ pnpm i @databases/pg-migrations
$ npx pg-migrations \
  --directory ./node_modules/@equinox-js/message-db/migrations \
  --version-table eqx_mdb_migrations_version \
  --migrations-table eqx_mdb_migrations_applied
```
