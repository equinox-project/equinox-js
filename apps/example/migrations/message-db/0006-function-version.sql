CREATE OR REPLACE FUNCTION message_store.message_store_version()
RETURNS varchar
AS $$
BEGIN
  RETURN '1.3.0';
END;
$$ LANGUAGE plpgsql
VOLATILE;
