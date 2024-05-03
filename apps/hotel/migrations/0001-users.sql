DO $$
BEGIN
  CREATE ROLE equinox_hotel WITH LOGIN;
EXCEPTION
  WHEN duplicate_object THEN
      RAISE NOTICE 'The equinox_hotel role already exists';
END$$;
alter role equinox_hotel set search_path to message_store, public;
grant message_store to equinox_hotel;
