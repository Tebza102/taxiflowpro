-- TaxiFlow LOCAL baseline (isolated test database only; never apply to a hosted project).
--
-- Contract (from the code, 2026-10-10): the browser client, the API routes and the
-- scripts use exactly one table, public.workspace_snapshots, keyed by
-- workspace_key ('taxiflow-live'), holding the whole workspace as jsonb with an
-- updated_at version used for compare-and-swap writes. The other tables in
-- supabase/schema.sql (fleet_profiles, vehicles, ...) are an unused future
-- normalised schema and are deliberately NOT created here.
--
-- Columns, constraints and index match the live table (read-only inventory,
-- PostgreSQL 17.6).
create table public.workspace_snapshots (
  workspace_key text primary key,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.workspace_snapshots enable row level security;

-- Grants are the INTENDED target, not a copy of live. Live currently grants anon
-- and authenticated every privilege, including TRUNCATE, which RLS does not
-- govern. The app only ever needs select/insert/update as an authenticated user;
-- server code uses the service role.
revoke all on table public.workspace_snapshots from anon, authenticated;
grant select, insert, update on table public.workspace_snapshots to authenticated;
