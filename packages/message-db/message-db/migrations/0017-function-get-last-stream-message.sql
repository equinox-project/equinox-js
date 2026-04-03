CREATE OR REPLACE FUNCTION message_store.get_last_stream_message(
  stream_name varchar,
  type varchar DEFAULT NULL
)
RETURNS SETOF message_store.message
AS $$
DECLARE
  _command text;
BEGIN
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
      stream_name = $1';

  IF get_last_stream_message.type IS NOT NULL THEN
    _command := _command || ' AND
      type = $2';
  END IF;

  _command := _command || '
    ORDER BY
      position DESC
    LIMIT
      1';

  RETURN QUERY EXECUTE _command USING
    get_last_stream_message.stream_name,
    get_last_stream_message.type;
END;
$$ LANGUAGE plpgsql
VOLATILE;
