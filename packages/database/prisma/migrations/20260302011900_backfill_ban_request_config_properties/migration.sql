-- Backfill new ban_requests config properties into existing Guild JSONB configs.
-- Adds: notify_target (true), disable_reason_field (false), additional_info (null)

UPDATE "Guild"
SET config = jsonb_set(
  jsonb_set(
    jsonb_set(
      config,
      '{ban_requests,notify_target}',
      'true'::jsonb,
      true
    ),
    '{ban_requests,disable_reason_field}',
    'false'::jsonb,
    true
  ),
  '{ban_requests,additional_info}',
  'null'::jsonb,
  true
)
WHERE config ? 'ban_requests'
  AND (
    NOT (config->'ban_requests' ? 'notify_target')
    OR NOT (config->'ban_requests' ? 'disable_reason_field')
    OR NOT (config->'ban_requests' ? 'additional_info')
  );
