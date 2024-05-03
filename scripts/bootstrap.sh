createdb -U postgres -h localhost message_store
npx pg-migrations apply --database postgresql://postgres:@localhost:5432/message_store --directory ./packages/message-db/message-db/migrations --version-table mdb_migrations_version --migrations-table mdb_migrations_applied

(cd ./apps/example && direnv exec . pnpm create-db)
(cd ./apps/example && direnv exec . pnpm migrate)
(cd ./apps/hotel && direnv exec . pnpm create-db)
(cd ./apps/hotel && direnv exec . pnpm migrate)
