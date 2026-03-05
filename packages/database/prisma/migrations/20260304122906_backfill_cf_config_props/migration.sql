-- Backfill new content_filter config properties into existing Guild JSONB configs.
-- Adds: webhook_channel (null)

UPDATE "Guild"
SET config = jsonb_set(
  config,
  '{content_filter,webhook_channel}',
  'null'::jsonb,
  true
)
WHERE config ? 'content_filter'
  AND NOT (config->'content_filter' ? 'webhook_channel');
