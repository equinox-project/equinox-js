CREATE OR REPLACE FUNCTION message_store.get_stream_messages(
  stream_name varchar,
  "position" bigint DEFAULT 0,
  batch_size bigint DEFAULT 1000,
  condition varchar DEFAULT NULL
)
RETURNS SETOF message_store.message
AS $$
DECLARE
  _command text;
  _setting text;
BEGIN
  IF is_category(get_stream_messages.stream_name) THEN
    RAISE EXCEPTION
      'Must be a stream name: %',
      get_stream_messages.stream_name;
  END IF;

  position := COALESCE(position, 0);
  batch_size := COALESCE(batch_size, 1000);

  _command := '
    SELECT
      id::varchar,
      stream_name::varchar,
      type::varchar,
      position::bigint,
      xid::xid8 as global_position,
      data::jsonb,
      metadata::jsonb,
      time::timestamp
    FROM
      messages
    WHERE
      stream_name = $1 AND
      position >= $2
    ORDER BY
      position ASC
    LIMIT $3';

  RETURN QUERY EXECUTE _command USING
    get_stream_messages.stream_name,
    get_stream_messages.position,
    get_stream_messages.batch_size;
END;
$$ LANGUAGE plpgsql
VOLATILE;
