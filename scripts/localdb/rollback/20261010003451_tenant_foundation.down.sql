-- NOT A PRODUCTION RECOVERY PROCEDURE. This rollback deliberately restores the
-- flagged live-mirror access (any authenticated user can read and overwrite the
-- whole snapshot). It exists only to prove local compatibility and lossless
-- re-application. A real incident needs a reviewed forward fix or a restore
-- from a verified backup, never this file.
-- Rollback of 20261010003451_tenant_foundation.sql (LOCAL only).
-- Restores the PRE-TENANT ACCESS behaviour, i.e. the flagged live-mirror
-- (known insecure) policies and grants that the unchanged app needs, and
-- removes the tenant functions/triggers/policies. It deliberately keeps all
-- data: businesses, business_memberships and workspace_snapshots.business_id
-- stay in place (dormant), so re-applying the up migration is lossless.

drop policy if exists "members read their businesses" on public.businesses;
drop policy if exists "read own or administered memberships" on public.business_memberships;

drop trigger if exists workspace_snapshots_no_tenant_reassignment on public.workspace_snapshots;
drop trigger if exists business_memberships_no_reassignment on public.business_memberships;
drop function if exists public.set_business_membership(uuid, uuid, text, boolean, text);
drop function if exists taxiflow_private.forbid_tenant_reassignment();
drop function if exists taxiflow_private.is_active_member(uuid, text[]);

revoke all on table public.businesses from anon, authenticated;
revoke all on table public.business_memberships from anon, authenticated;

alter table public.workspace_snapshots alter column business_id drop not null;

-- Pre-tenant snapshot access (same as migration 20261009232610, known insecure).
revoke all on table public.workspace_snapshots from anon, authenticated;
grant select, insert, update on table public.workspace_snapshots to authenticated;
drop policy if exists "LIVE MIRROR (insecure): authenticated read" on public.workspace_snapshots;
drop policy if exists "LIVE MIRROR (insecure): authenticated insert" on public.workspace_snapshots;
drop policy if exists "LIVE MIRROR (insecure): authenticated update" on public.workspace_snapshots;
create policy "LIVE MIRROR (insecure): authenticated read"
  on public.workspace_snapshots for select to authenticated using (true);
create policy "LIVE MIRROR (insecure): authenticated insert"
  on public.workspace_snapshots for insert to authenticated with check (true);
create policy "LIVE MIRROR (insecure): authenticated update"
  on public.workspace_snapshots for update to authenticated using (true) with check (true);
