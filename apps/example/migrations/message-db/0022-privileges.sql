-- schema
GRANT USAGE ON SCHEMA message_store TO message_store;

-- table
GRANT SELECT, INSERT ON message_store.messages TO message_store;

-- sequence
GRANT USAGE, SELECT ON SEQUENCE message_store.messages_global_position_seq TO message_store;

-- functions
GRANT EXECUTE ON FUNCTION gen_random_uuid() TO message_store;

GRANT EXECUTE ON FUNCTION message_store.acquire_lock(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.cardinal_id(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.category(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.get_category_messages(varchar, bigint, bigint, varchar, bigint, bigint, varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.get_last_stream_message(varchar, varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.get_stream_messages(varchar, bigint, bigint, varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.hash_64(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.id(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.is_category(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.message_store_version() TO message_store;
GRANT EXECUTE ON FUNCTION message_store.stream_version(varchar) TO message_store;
GRANT EXECUTE ON FUNCTION message_store.write_message(varchar, varchar, varchar, jsonb, jsonb, bigint) TO message_store;

-- views
GRANT SELECT ON message_store.category_type_summary TO message_store;
GRANT SELECT ON message_store.stream_summary TO message_store;
GRANT SELECT ON message_store.stream_type_summary TO message_store;
GRANT SELECT ON message_store.type_category_summary TO message_store;
GRANT SELECT ON message_store.type_stream_summary TO message_store;
GRANT SELECT ON message_store.type_summary TO message_store;
