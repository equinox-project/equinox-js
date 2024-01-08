CREATE OR REPLACE VIEW message_store.category_type_summary AS
  WITH
    type_count AS (
      SELECT
        message_store.category(stream_name) AS category,
        type,
        COUNT(id) AS message_count
      FROM
        message_store.messages
      GROUP BY
        category,
        type
    ),

    total_count AS (
      SELECT
        COUNT(id)::decimal AS total_count
      FROM
        message_store.messages
    )

  SELECT
    category,
    type,
    message_count,
    ROUND((message_count / total_count)::decimal * 100, 2) AS percent
  FROM
    type_count,
    total_count
  ORDER BY
    category,
    type;

CREATE OR REPLACE VIEW message_store.stream_summary AS
  WITH
    stream_count AS (
      SELECT
        stream_name,
        COUNT(id) AS message_count
      FROM
        message_store.messages
      GROUP BY
        stream_name
    ),

    total_count AS (
      SELECT
        COUNT(id)::decimal AS total_count
      FROM
        message_store.messages
    )

  SELECT
    stream_name,
    message_count,
    ROUND((message_count / total_count)::decimal * 100, 2) AS percent
  FROM
    stream_count,
    total_count
  ORDER BY
    stream_name;

CREATE OR REPLACE VIEW message_store.stream_type_summary AS
  WITH
    type_count AS (
      SELECT
        stream_name,
        type,
        COUNT(id) AS message_count
      FROM
        message_store.messages
      GROUP BY
        stream_name,
        type
    ),

    total_count AS (
      SELECT
        COUNT(id)::decimal AS total_count
      FROM
        message_store.messages
    )

  SELECT
    stream_name,
    type,
    message_count,
    ROUND((message_count / total_count)::decimal * 100, 2) AS percent
  FROM
    type_count,
    total_count
  ORDER BY
    stream_name,
    type;

CREATE OR REPLACE VIEW message_store.type_category_summary AS
  WITH
    type_count AS (
      SELECT
        type,
        message_store.category(stream_name) AS category,
        COUNT(id) AS message_count
      FROM
        message_store.messages
      GROUP BY
        type,
        category
    ),

    total_count AS (
      SELECT
        COUNT(id)::decimal AS total_count
      FROM
        message_store.messages
    )

  SELECT
    type,
    category,
    message_count,
    ROUND((message_count / total_count)::decimal * 100, 2) AS percent
  FROM
    type_count,
    total_count
  ORDER BY
    type,
    category;

CREATE OR REPLACE VIEW message_store.type_stream_summary AS
  WITH
    type_count AS (
      SELECT
        type,
        stream_name,
        COUNT(id) AS message_count
      FROM
        message_store.messages
      GROUP BY
        type,
        stream_name
    ),

    total_count AS (
      SELECT
        COUNT(id)::decimal AS total_count
      FROM
        message_store.messages
    )

  SELECT
    type,
    stream_name,
    message_count,
    ROUND((message_count / total_count)::decimal * 100, 2) AS percent
  FROM
    type_count,
    total_count
  ORDER BY
    type,
    stream_name;

CREATE OR REPLACE VIEW message_store.type_summary AS
  WITH
    type_count AS (
      SELECT
        type,
        COUNT(id) AS message_count
      FROM
        message_store.messages
      GROUP BY
        type
    ),

    total_count AS (
      SELECT
        COUNT(id)::decimal AS total_count
      FROM
        message_store.messages
    )

  SELECT
    type,
    message_count,
    ROUND((message_count / total_count)::decimal * 100, 2) AS percent
  FROM
    type_count,
    total_count
  ORDER BY
    type;
