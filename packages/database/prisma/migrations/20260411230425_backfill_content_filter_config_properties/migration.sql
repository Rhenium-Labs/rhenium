-- Backfill new content filter config properties for existing guilds.
-- Adds: use_heuristic_scanner (boolean, default true)

UPDATE "Guild"
SET config = jsonb_set(
  config,
  '{content_filter,use_heuristic_scanner}',
  'true'::jsonb,
  true
)
WHERE config ? 'content_filter'
  AND NOT (config->'content_filter' ? 'use_heuristic_scanner');