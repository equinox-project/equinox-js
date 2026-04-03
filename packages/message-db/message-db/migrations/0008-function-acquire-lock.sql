CREATE OR REPLACE FUNCTION message_store.acquire_lock(
  stream_name varchar
)
RETURNS bigint
AS $$
DECLARE
  _stream_name_hash bigint;
BEGIN
  _stream_name_hash := hash_64(acquire_lock.stream_name);
  PERFORM pg_advisory_xact_lock(_stream_name_hash);
  RETURN _stream_name_hash;
END;
$$ LANGUAGE plpgsql
VOLATILE;
