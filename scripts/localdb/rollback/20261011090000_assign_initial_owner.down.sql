-- Rollback of 20261011090000_assign_initial_owner.sql (LOCAL only; NOT A PRODUCTION
-- RECOVERY PROCEDURE). Memberships it created are kept.
drop function if exists public.assign_initial_owner(uuid, uuid, text, timestamptz, jsonb);
