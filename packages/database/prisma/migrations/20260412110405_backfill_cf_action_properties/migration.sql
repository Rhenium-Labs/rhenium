-- Backfill new content_filter detector action properties for existing guilds.
-- Adds: detector_actions with NSFW/OCR/TEXT defaults.
-- Also ensures NSFW.apply_to_text_nsfw exists for partially populated configs.

UPDATE "Guild"
SET config = jsonb_set(
	config,
	'{content_filter,detector_actions}',
	'{
	  "NSFW": {
	    "delete_message": false,
	    "timeout_user": false,
	    "timeout_duration_ms": 600000,
	    "apply_to_text_nsfw": false
	  },
	  "OCR": {
	    "delete_message": false,
	    "timeout_user": false,
	    "timeout_duration_ms": 600000
	  },
	  "TEXT": {
	    "delete_message": false,
	    "timeout_user": false,
	    "timeout_duration_ms": 600000
	  }
	}'::jsonb,
	true
)
WHERE config ? 'content_filter'
	AND NOT (config->'content_filter' ? 'detector_actions');

UPDATE "Guild"
SET config = jsonb_set(
	config,
	'{content_filter,detector_actions,NSFW,apply_to_text_nsfw}',
	'false'::jsonb,
	true
)
WHERE config ? 'content_filter'
	AND (config->'content_filter' ? 'detector_actions')
	AND NOT (
		COALESCE(config#>'{content_filter,detector_actions,NSFW}', '{}'::jsonb)
		? 'apply_to_text_nsfw'
	);
