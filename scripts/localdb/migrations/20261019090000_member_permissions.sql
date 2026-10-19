-- Release file 06: per-member responsibilities (additive).
--
-- Owner-assigned responsibilities on each Admin or Manager membership:
--   cash.count      record a driver's day hand-in / count standalone income
--   cash.verify     verify a counted day / standalone income
--   cash.bank       finish a deposit (bank the verified batch)
--   drivers.manage  driver profiles and driver assignments (never sign-ins)
--   fleet.manage    routes and vehicles
-- The Owner always holds every responsibility (enforced in the server, not
-- stored). Drivers hold none. Module view access (Money, Fleet, Drivers) still
-- applies on top: a permission never bypasses a switched-off module.
--
-- Effective permissions are preserved: every existing membership is backfilled
-- with exactly what its role could do before this file (Admin counts; Manager
-- verifies and banks). A role change resets the permissions to the new role's
-- defaults, so granting a different role never carries old powers across.
-- Only an active Owner can change permissions, never their own and never an
-- Owner's, through public.set_member_permissions (service role only).

alter table public.business_memberships
  add column if not exists permissions text[] not null default '{}'::text[];

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'business_memberships_permissions_known') then
    alter table public.business_memberships
      add constraint business_memberships_permissions_known
      check (permissions <@ array['cash.count', 'cash.verify', 'cash.bank', 'drivers.manage', 'fleet.manage']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_memberships_permissions_roles') then
    alter table public.business_memberships
      add constraint business_memberships_permissions_roles
      check (role in ('Admin', 'Manager') or permissions = '{}'::text[]);
  end if;
end $$;

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

-- New memberships start with their role's defaults; a role change resets them.
create or replace function taxiflow_private.member_permissions_follow_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.permissions is null or new.permissions = '{}'::text[] then
      new.permissions := taxiflow_private.default_member_permissions(new.role);
    end if;
  elsif new.role is distinct from old.role then
    new.permissions := taxiflow_private.default_member_permissions(new.role);
  end if;
  return new;
end;
$$;

-- Backfill before the trigger exists: existing rows get exactly their role's
-- current powers. Idempotent (only rows still at the column default change).
update public.business_memberships
set permissions = taxiflow_private.default_member_permissions(role)
where permissions = '{}'::text[]
  and taxiflow_private.default_member_permissions(role) <> '{}'::text[];

drop trigger if exists business_memberships_permissions_follow_role on public.business_memberships;
create trigger business_memberships_permissions_follow_role
  before insert or update on public.business_memberships
  for each row
  execute function taxiflow_private.member_permissions_follow_role();

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
  v_target public.business_memberships;
  v_clean text[];
  v_version timestamptz := clock_timestamp();
  v_rows integer;
begin
  perform 1 from public.business_memberships
  where business_id = p_business_id and user_id = p_actor and active and role = 'Owner';
  if not found then
    raise exception 'Only an active Owner of this business can change staff responsibilities.' using errcode = '42501';
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
  if not (v_clean <@ array['cash.count', 'cash.verify', 'cash.bank', 'drivers.manage', 'fleet.manage']::text[]) then
    raise exception 'Unknown responsibility.' using errcode = '22023';
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
