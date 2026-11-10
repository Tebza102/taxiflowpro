-- Removes the logbook review queue. Approved rows already written to the
-- business snapshot stay there (they are ordinary finance records).
drop function if exists public.logbook_rate_take(uuid, integer, integer);
drop function if exists public.commit_logbook_approval(uuid, uuid, text, timestamptz, jsonb, uuid, text, jsonb, jsonb);
drop function if exists public.logbook_reject_row(uuid, uuid, uuid, text, text);
drop function if exists public.logbook_edit_row(uuid, uuid, uuid, text, jsonb, jsonb, text);
drop function if exists public.logbook_queue(uuid, text, text, text, uuid, text, uuid, uuid, jsonb, jsonb);
drop table if exists public.logbook_row_events;
drop table if exists public.logbook_rows;
drop table if exists public.logbook_pages;
drop table if exists public.logbook_batches;
drop table if exists public.logbook_api_key_usage;
drop table if exists public.logbook_api_keys;
