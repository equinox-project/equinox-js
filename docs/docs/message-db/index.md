---
sidebar_position: 5
---

# MessageDB

MessageDB is a fully-featured event store and message store implemented in PostgreSQL for Pub/Sub, Event Sourcing,
Messaging, and Evented Microservices applications. It was extracted from
the [Eventide Project](http://docs.eventide-project.org/) to make it easier for users to write clients in the language
of their choosing.

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

<!-- Uncomment once we actually release --> 
<!--
## pg-migrations

While this can work well it's not particularly great to use in IaC scenarios as
the installer is not idempotent. To combat this we offer a set of migrations you
can use with `@database/pg-migrations`.

```sh
$ pnpm i @database/pg-migrations
$ npx pg-migrations \
  --directory ./node_modules/@equinox-js/message-db/migrations \
  --version-table eqx_mdb_migrations_version \
  --migrations-table eqx_mdb_migrations_applied
```
-->
