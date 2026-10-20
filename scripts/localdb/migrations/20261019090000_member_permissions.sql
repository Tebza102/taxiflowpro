-- Release file 06: per-member responsibilities (additive).
--
-- Owner-assigned responsibilities on each Admin or Manager membership:
--   cash.count      record a driver's day hand-in / count standalone income
--   cash.verify     verify a counted day / standalone income
--   cash.bank       finish a deposit (bank the verified batch)
--   drivers.manage  driver profiles and driver assignments (never sign-ins)
--   fleet.manage    routes and vehicles
--   staff.manage    change other Admins'/Managers' responsibilities, only
--                   within the actor's own (never staff.manage itself, never
--                   roles or sign-ins); granted by the Owner only
-- The Owner always holds every responsibility (enforced in the server, not
-- stored). Drivers hold none. Module view access (Money, Fleet, Drivers) still
-- applies on top: a permission never bypasses a switched-off module.
--
-- Effective permissions are preserved: every existing membership is backfilled
-- with exactly what its role could do before this file (Admin counts; Manager
-- verifies and banks). A role change resets the permissions to the new role's
-- defaults, so granting a different role never carries old powers across.
-- Changes go through public.set_member_permissions (service role only): an
-- active Owner, or an active Admin/Manager holding staff.manage within its
-- delegation limits. Nobody changes their own entry or an Owner's. Every change
-- is recorded in public.member_permission_changes (one row per change, keyed by
-- business; no browser access).

create or replace function taxiflow_private.default_member_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'Admin' then array['cash.count']::text[]
    when 'Manager' then array['cash.verify', 'cash.bank']::text[]
    else '{}'::text[]
  end;
$$;

-- Add and backfill ONLY when the column is new: existing rows get exactly their
-- role's current powers. A re-run never touches stored lists again (an Owner
-- may have emptied one on purpose).
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'business_memberships' and column_name = 'permissions'
  ) then
    alter table public.business_memberships add column permissions text[] not null default '{}'::text[];
    update public.business_memberships
    set permissions = taxiflow_private.default_member_permissions(role)
    where taxiflow_private.default_member_permissions(role) <> '{}'::text[];
  end if;
end $$;

do $$ begin
  -- Re-created so a re-run always carries the current list of known keys.
  alter table public.business_memberships drop constraint if exists business_memberships_permissions_known;
  alter table public.business_memberships
    add constraint business_memberships_permissions_known
    check (permissions <@ array['cash.count', 'cash.verify', 'cash.bank', 'drivers.manage', 'fleet.manage', 'staff.manage']::text[]);
  if not exists (select 1 from pg_constraint where conname = 'business_memberships_permissions_roles') then
    alter table public.business_memberships
      add constraint business_memberships_permissions_roles
      check (role in ('Admin', 'Manager') or permissions = '{}'::text[]);
  end if;
end $$;

-- New memberships start with their role's defaults; a role change resets them.
create or replace function taxiflow_private.member_permissions_follow_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Only a row that does not state its permissions (NULL: the column has no
    -- default) gets the role defaults. An explicit list, including an empty one
    -- the Owner chose, is kept exactly (a backup restore must not re-grant).
    if new.permissions is null then
      new.permissions := taxiflow_private.default_member_permissions(new.role);
    end if;
  elsif new.role is distinct from old.role then
    new.permissions := taxiflow_private.default_member_permissions(new.role);
  end if;
  return new;
end;
$$;

drop trigger if exists business_memberships_permissions_follow_role on public.business_memberships;
create trigger business_memberships_permissions_follow_role
  before insert or update on public.business_memberships
  for each row
  execute function taxiflow_private.member_permissions_follow_role();

-- After the backfill: no column default, so an insert that omits permissions
-- arrives as NULL and the trigger fills the role defaults (NOT NULL is checked
-- after BEFORE triggers); an insert that states them, e.g. a restore, is kept.
alter table public.business_memberships alter column permissions drop default;

-- Tenant-scoped audit of every responsibility change (kept on rollback).
create table if not exists public.member_permission_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor_user_id uuid not null,
  actor_role text not null,
  target_user_id uuid not null,
  permissions_before text[] not null,
  permissions_after text[] not null,
  changed_at timestamptz not null default now()
);
create index if not exists member_permission_changes_business_idx
  on public.member_permission_changes (business_id, changed_at desc);
alter table public.member_permission_changes enable row level security;
alter table public.member_permission_changes force row level security;
revoke all on table public.member_permission_changes from public, anon, authenticated;
grant select on table public.member_permission_changes to service_role;

create or replace function public.set_member_permissions(
  p_business_id uuid,
  p_actor uuid,
  p_user_id uuid,
  p_permissions text[],
  p_expected_updated_at timestamptz,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.business_memberships;
  v_target public.business_memberships;
  v_clean text[];
  v_changed text[];
  v_delegable text[];
  v_version timestamptz := clock_timestamp();
  v_rows integer;
begin
  select * into v_actor from public.business_memberships
  where business_id = p_business_id and user_id = p_actor and active;
  if not found or not (v_actor.role = 'Owner' or (v_actor.role in ('Admin', 'Manager') and 'staff.manage' = any (v_actor.permissions))) then
    raise exception 'Only the Owner, or someone given "Manage staff responsibilities", can change staff responsibilities.' using errcode = '42501';
  end if;
  if p_user_id = p_actor then
    raise exception 'You cannot change your own responsibilities.' using errcode = '42501';
  end if;

  select * into v_target from public.business_memberships
  where business_id = p_business_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'That person is not a member of this business.' using errcode = 'P0002';
  end if;
  if v_target.role not in ('Admin', 'Manager') then
    raise exception 'Only Admin and Manager responsibilities can be changed.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct p order by p), '{}'::text[]) into v_clean
  from unnest(coalesce(p_permissions, '{}'::text[])) as p;
  if not (v_clean <@ array['cash.count', 'cash.verify', 'cash.bank', 'drivers.manage', 'fleet.manage', 'staff.manage']::text[]) then
    raise exception 'Unknown responsibility.' using errcode = '22023';
  end if;

  -- Delegation limits: a non-Owner changes only responsibilities it holds
  -- itself, never staff.manage, and never another staff manager.
  if v_actor.role <> 'Owner' then
    if 'staff.manage' = any (v_target.permissions) then
      raise exception 'Only the Owner can change the responsibilities of someone who manages staff.' using errcode = '42501';
    end if;
    select coalesce(array_agg(p), '{}'::text[]) into v_changed from (
      (select unnest(v_clean) except select unnest(v_target.permissions))
      union
      (select unnest(v_target.permissions) except select unnest(v_clean))
    ) d(p);
    v_delegable := array_remove(v_actor.permissions, 'staff.manage');
    if not (v_changed <@ v_delegable) then
      raise exception 'You can only give or remove responsibilities you hold yourself.' using errcode = '42501';
    end if;
  end if;

  if p_snapshot is not null then
    update public.workspace_snapshots
    set snapshot = p_snapshot, updated_at = v_version, updated_by = p_actor
    where business_id = p_business_id and updated_at = p_expected_updated_at;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('status', 'conflict');
    end if;
  end if;

  update public.business_memberships
  set permissions = v_clean, updated_at = now(), updated_by = p_actor
  where business_id = p_business_id and user_id = p_user_id;

  insert into public.member_permission_changes (business_id, actor_user_id, actor_role, target_user_id, permissions_before, permissions_after)
  values (p_business_id, p_actor, v_actor.role, p_user_id, v_target.permissions, v_clean);

  return jsonb_build_object(
    'status', 'applied',
    'version', case when p_snapshot is null then null else v_version end,
    'permissions', to_jsonb(v_clean)
  );
end;
$$;

revoke all on function taxiflow_private.default_member_permissions(text) from public, anon, authenticated;
revoke all on function taxiflow_private.member_permissions_follow_role() from public, anon, authenticated;
revoke all on function public.set_member_permissions(uuid, uuid, uuid, text[], timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.set_member_permissions(uuid, uuid, uuid, text[], timestamptz, jsonb) to service_role;
