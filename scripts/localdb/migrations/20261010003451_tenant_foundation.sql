-- Tenant database foundation (LOCAL hardened variant; never applied to a hosted
-- project from here). Design: project-os/04-technical/tenant-design.md.
-- Idempotent so the rollback in scripts/localdb/rollback can be re-applied.

create schema if not exists taxiflow_private;
revoke all on schema taxiflow_private from public, anon, authenticated;

-- --- Tables -------------------------------------------------------------------

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.business_memberships (
  business_id uuid not null references public.businesses (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('Owner', 'Admin', 'Manager', 'Driver')),
  driver_staff_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (business_id, user_id),
  constraint driver_needs_staff_id check (role <> 'Driver' or driver_staff_id is not null)
);

create unique index if not exists business_memberships_driver_staff_unique
  on public.business_memberships (business_id, driver_staff_id)
  where driver_staff_id is not null;

alter table public.workspace_snapshots add column if not exists business_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_snapshots_business_fkey') then
    alter table public.workspace_snapshots
      add constraint workspace_snapshots_business_fkey foreign key (business_id) references public.businesses (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspace_snapshots_business_unique') then
    alter table public.workspace_snapshots add constraint workspace_snapshots_business_unique unique (business_id);
  end if;
end $$;

-- --- Explicit mapping of the existing workspace (no shared fallback) ------------

insert into public.businesses (id, slug, name)
values ('10000000-0000-4000-8000-00000000000a', 'taxiflow-legacy', 'TaxiFlow Pro')
on conflict (id) do nothing;

update public.workspace_snapshots
set business_id = '10000000-0000-4000-8000-00000000000a'
where workspace_key = 'taxiflow-live' and business_id is null;

do $$ begin
  if exists (select 1 from public.workspace_snapshots where business_id is null) then
    raise exception 'Unmapped workspace_snapshots rows exist; add an explicit business mapping before applying the tenant foundation.';
  end if;
end $$;

alter table public.workspace_snapshots alter column business_id set not null;

-- Memberships only for exact, active, allowed-role appUsers matches. Unmatched
-- accounts get no access (fail closed). Viewer is never a membership.
insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active)
select s.business_id, u.id, a ->> 'role', nullif(trim(a ->> 'staffId'), ''), true
from public.workspace_snapshots s
cross join lateral jsonb_array_elements(coalesce(s.snapshot -> 'appUsers', '[]'::jsonb)) a
join auth.users u on lower(u.email) = lower(trim(a ->> 'email'))
where s.workspace_key = 'taxiflow-live'
  and coalesce((a ->> 'active')::boolean, true)
  and a ->> 'role' in ('Owner', 'Admin', 'Manager', 'Driver')
  and (a ->> 'role' <> 'Driver' or nullif(trim(a ->> 'staffId'), '') is not null)
on conflict (business_id, user_id) do nothing;

-- --- Helpers (security definer, fixed search_path) -----------------------------

create or replace function taxiflow_private.is_active_member(p_business_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.active
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function taxiflow_private.forbid_tenant_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Separate branches: PL/pgSQL resolves every NEW field named in an
  -- expression, so a combined condition naming new.user_id breaks every
  -- workspace_snapshots update (that table has no user_id).
  if tg_table_name = 'workspace_snapshots' then
    if new.business_id is distinct from old.business_id then
      raise exception 'A workspace snapshot cannot be moved to another business.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'business_memberships' then
    if new.business_id is distinct from old.business_id or new.user_id is distinct from old.user_id then
      raise exception 'A membership cannot be moved to another business or user.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_snapshots_no_tenant_reassignment on public.workspace_snapshots;
create trigger workspace_snapshots_no_tenant_reassignment
  before update on public.workspace_snapshots
  for each row execute function taxiflow_private.forbid_tenant_reassignment();

drop trigger if exists business_memberships_no_reassignment on public.business_memberships;
create trigger business_memberships_no_reassignment
  before update on public.business_memberships
  for each row execute function taxiflow_private.forbid_tenant_reassignment();

-- Owner-only membership administration. No self-assignment, no Owner minting,
-- no change to existing Owner memberships, business fixed by the key.
create or replace function public.set_business_membership(
  p_business_id uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean default true,
  p_driver_staff_id text default null
)
returns public.business_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing public.business_memberships;
  result public.business_memberships;
begin
  if caller is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if not taxiflow_private.is_active_member(p_business_id, array['Owner']) then
    raise exception 'Only an active Owner of this business can manage its memberships.' using errcode = '42501';
  end if;
  if p_user_id = caller then
    raise exception 'You cannot change your own membership.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('Admin', 'Manager', 'Driver') then
    raise exception 'Role % cannot be assigned here.', coalesce(p_role, 'null') using errcode = '42501';
  end if;
  select * into existing from public.business_memberships
  where business_id = p_business_id and user_id = p_user_id;
  if found and existing.role = 'Owner' then
    raise exception 'Owner memberships cannot be changed here.' using errcode = '42501';
  end if;

  insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active, updated_by)
  values (p_business_id, p_user_id, p_role, nullif(trim(p_driver_staff_id), ''), coalesce(p_active, true), caller)
  on conflict (business_id, user_id) do update
    set role = excluded.role,
        driver_staff_id = excluded.driver_staff_id,
        active = excluded.active,
        updated_at = now(),
        updated_by = caller
  returning * into result;
  return result;
end;
$$;

-- --- Grants (explicit; RLS does not govern TRUNCATE) ---------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

revoke all on table public.workspace_snapshots from anon, authenticated;
revoke all on table public.businesses from anon, authenticated;
revoke all on table public.business_memberships from anon, authenticated;
grant select on table public.businesses to authenticated;
grant select on table public.business_memberships to authenticated;

revoke all on function taxiflow_private.is_active_member(uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function taxiflow_private.forbid_tenant_reassignment() from public, anon, authenticated;
-- service_role is revoked too: the RPC is only for signed-in Owners (auth.uid());
-- server-side ownership changes must use explicit, separately reviewed code.
revoke all on function public.set_business_membership(uuid, uuid, text, boolean, text) from public, anon, authenticated, service_role;
grant usage on schema taxiflow_private to authenticated;
grant execute on function taxiflow_private.is_active_member(uuid, text[]) to authenticated;
grant execute on function public.set_business_membership(uuid, uuid, text, boolean, text) to authenticated;

-- --- RLS ------------------------------------------------------------------------

alter table public.workspace_snapshots enable row level security;
alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;

-- Replace the insecure live-mirror policies: no browser policy on snapshots.
drop policy if exists "LIVE MIRROR (insecure): authenticated read" on public.workspace_snapshots;
drop policy if exists "LIVE MIRROR (insecure): authenticated insert" on public.workspace_snapshots;
drop policy if exists "LIVE MIRROR (insecure): authenticated update" on public.workspace_snapshots;

drop policy if exists "members read their businesses" on public.businesses;
create policy "members read their businesses" on public.businesses
  for select to authenticated
  using (taxiflow_private.is_active_member(id));

drop policy if exists "read own or administered memberships" on public.business_memberships;
create policy "read own or administered memberships" on public.business_memberships
  for select to authenticated
  using (
    (user_id = auth.uid() and active)
    or taxiflow_private.is_active_member(business_id, array['Owner', 'Admin'])
  );
