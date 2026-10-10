-- Rollback of 20261010063144_finance_actions.sql (LOCAL only; NOT A PRODUCTION
-- RECOVERY PROCEDURE). Removes the server write function and the idempotency
-- log. Workspace snapshots are untouched; only the request log is lost.
drop function if exists public.commit_finance_action(uuid, timestamptz, jsonb, uuid, uuid, text, text, text, jsonb);
drop table if exists public.finance_action_requests;
