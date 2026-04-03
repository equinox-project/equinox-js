CREATE OR REPLACE FUNCTION message_store.get_category_messages(
  category varchar,
  "position" xid8,
  batch_size bigint DEFAULT 1000,
  correlation varchar DEFAULT NULL,
  consumer_group_member bigint DEFAULT NULL,
  consumer_group_size bigint DEFAULT NULL,
  condition varchar DEFAULT NULL
)
RETURNS SETOF message_store.message
AS $$
DECLARE
  _command text;
BEGIN
  IF NOT is_category(get_category_messages.category) THEN
    RAISE EXCEPTION
      'Must be a category: %',
      get_category_messages.category;
  END IF;

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
      category(stream_name) = $1 AND
      xid >= $2 AND
      xid < pg_snapshot_xmin(pg_current_snapshot())';

  IF (get_category_messages.consumer_group_member IS NOT NULL AND
      get_category_messages.consumer_group_size IS NULL) OR
      (get_category_messages.consumer_group_member IS NULL AND
      get_category_messages.consumer_group_size IS NOT NULL) THEN

    RAISE EXCEPTION
      'Consumer group member and size must be specified (Consumer Group Member: %, Consumer Group Size: %)',
      get_category_messages.consumer_group_member,
      get_category_messages.consumer_group_size;
  END IF;

  IF get_category_messages.consumer_group_member IS NOT NULL AND
      get_category_messages.consumer_group_size IS NOT NULL THEN

    IF get_category_messages.consumer_group_size < 1 THEN
      RAISE EXCEPTION
        'Consumer group size must not be less than 1 (Consumer Group Member: %, Consumer Group Size: %)',
        get_category_messages.consumer_group_member,
        get_category_messages.consumer_group_size;
    END IF;

    IF get_category_messages.consumer_group_member < 0 THEN
      RAISE EXCEPTION
        'Consumer group member must not be less than 0 (Consumer Group Member: %, Consumer Group Size: %)',
        get_category_messages.consumer_group_member,
        get_category_messages.consumer_group_size;
    END IF;

    IF get_category_messages.consumer_group_member >= get_category_messages.consumer_group_size THEN
      RAISE EXCEPTION
        'Consumer group member must be less than the group size (Consumer Group Member: %, Consumer Group Size: %)',
        get_category_messages.consumer_group_member,
        get_category_messages.consumer_group_size;
    END IF;

    _command := _command || ' AND
      MOD(@hash_64(cardinal_id(stream_name)), $6) = $5';
  END IF;

  _command := _command || '
    ORDER BY
      xid ASC,
      global_position ASC';

  IF get_category_messages.batch_size != -1 THEN
    _command := _command || '
      LIMIT
        $3';
  END IF;

  RETURN QUERY EXECUTE _command USING
    get_category_messages.category,
    get_category_messages.position,
    get_category_messages.batch_size,
    get_category_messages.correlation,
    get_category_messages.consumer_group_member,
    get_category_messages.consumer_group_size::smallint;
END;
$$ LANGUAGE plpgsql
VOLATILE;
