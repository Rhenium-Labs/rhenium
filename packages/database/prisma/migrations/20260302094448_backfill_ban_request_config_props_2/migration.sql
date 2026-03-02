-- Backfill new ban_requests config properties into existing Guild JSONB configs.
-- Adds: delete_message_seconds (null)

UPDATE "Guild"
SET config = jsonb_set(
  config,
  '{ban_requests,delete_message_seconds}',
  'null'::jsonb,
  true
)
WHERE config ? 'ban_requests'
  AND NOT (config->'ban_requests' ? 'delete_message_seconds');
