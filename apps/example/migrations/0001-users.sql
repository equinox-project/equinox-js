DO $$
BEGIN
  CREATE ROLE equinox_example WITH LOGIN;
EXCEPTION
  WHEN duplicate_object THEN
      RAISE NOTICE 'The equinox_example role already exists';
END$$;
alter role equinox_example set search_path to message_store, public;
grant message_store to equinox_example;
