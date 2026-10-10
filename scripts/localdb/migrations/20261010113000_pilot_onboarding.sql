-- Pilot onboarding (LOCAL hardened variant; never applied to a hosted project
-- from here). Design: project-os/04-technical/tenant-design.md (Task 18).
-- Idempotent.
--
-- 1. A business always keeps at least one active Owner (database guard, so no
--    code path can remove the last one).
-- 2. Business creation with its initial Owner is an operator-only RPC
--    (service_role). Public users cannot create businesses or appoint Owners.
-- 3. Membership changes go through ONE server path (POST /api/business/members)
--    that calls a service_role-only RPC: the membership and the business
--    directory entry change in one transaction, with a snapshot compare-and-swap.
--    The earlier browser-callable set_business_membership is withdrawn.

-- --- 1. Last active Owner guard --------------------------------------------------
create or replace function taxiflow_private.keep_an_active_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  remaining integer;
begin
  if not (old.role = 'Owner' and old.active) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'Owner' and new.active then
    return new;
  end if;
  -- Serialize concurrent changes to the same business's Owners.
  perform 1 from public.businesses where id = old.business_id for update;
  select count(*) into remaining
  from public.business_memberships
  where business_id = old.business_id
    and role = 'Owner'
    and active
    and user_id <> old.user_id;
  if remaining = 0 then
    raise exception 'A business must keep at least one active Owner.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists business_memberships_keep_owner on public.business_memberships;
create trigger business_memberships_keep_owner
  before update or delete on public.business_memberships
  for each row execute function taxiflow_private.keep_an_active_owner();

-- --- 2. Operator: create a business with its initial Owner ----------------------
-- Idempotent by slug: a retry with the same slug and Owner returns 'existing'.
create or replace function public.create_business_with_owner(
  p_slug text,
  p_name text,
  p_owner_user_id uuid,
  p_owner_driver_staff_id text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_owner public.business_memberships;
begin
  select * into v_business from public.businesses where slug = p_slug;
  if found then
    select * into v_owner from public.business_memberships
    where business_id = v_business.id and user_id = p_owner_user_id and role = 'Owner';
    if not found then
      return jsonb_build_object('status', 'slug_taken');
    end if;
    return jsonb_build_object('status', 'existing', 'business_id', v_business.id, 'owner_active', v_owner.active);
  end if;

  insert into public.businesses (slug, name) values (p_slug, p_name) returning * into v_business;
  insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, updated_by, business_id)
  values (p_slug, p_snapshot, clock_timestamp(), p_owner_user_id, v_business.id);
  insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active, updated_by)
  values (v_business.id, p_owner_user_id, 'Owner', nullif(trim(p_owner_driver_staff_id), ''), true, p_owner_user_id);
  return jsonb_build_object('status', 'created', 'business_id', v_business.id);
end;
$$;

-- --- 3. Owner-managed membership change (called by the server only) -------------
-- p_actor is the server-verified caller. Rules (also checked by the server):
--   * the actor is an active Owner of p_business_id;
--   * Owners are never created or changed here, except an Owner's OWN driver link;
--   * no change to one's own role or active flag;
--   * roles assignable here: Admin, Manager, Driver;
--   * the membership row and the business directory snapshot commit together,
--     and only if the snapshot is still at p_expected_updated_at.
create or replace function public.apply_membership_change(
  p_business_id uuid,
  p_actor uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean,
  p_driver_staff_id text,
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
  v_existing public.business_memberships;
  v_version timestamptz := clock_timestamp();
  v_rows integer;
begin
  select * into v_actor from public.business_memberships
  where business_id = p_business_id and user_id = p_actor and active and role = 'Owner';
  if not found then
    raise exception 'Only an active Owner of this business can manage its access.' using errcode = '42501';
  end if;

  select * into v_existing from public.business_memberships
  where business_id = p_business_id and user_id = p_user_id;

  if p_user_id = p_actor then
    if p_role is distinct from 'Owner' or p_active is distinct from true then
      raise exception 'You cannot change your own role or access.' using errcode = '42501';
    end if;
  else
    if p_role is null or p_role not in ('Admin', 'Manager', 'Driver') then
      raise exception 'Role % cannot be assigned here.', coalesce(p_role, 'null') using errcode = '42501';
    end if;
    if found and v_existing.role = 'Owner' then
      raise exception 'Owner access is managed by the operator.' using errcode = '42501';
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

  insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active, updated_by)
  values (p_business_id, p_user_id, p_role, nullif(trim(p_driver_staff_id), ''), p_active, p_actor)
  on conflict (business_id, user_id) do update
    set role = excluded.role,
        driver_staff_id = excluded.driver_staff_id,
        active = excluded.active,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return jsonb_build_object('status', 'applied', 'version', v_version);
end;
$$;

-- --- Grants -------------------------------------------------------------------------
revoke all on function taxiflow_private.keep_an_active_owner() from public, anon, authenticated;
revoke all on function public.create_business_with_owner(text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_business_with_owner(text, text, uuid, text, jsonb) to service_role;
revoke all on function public.apply_membership_change(uuid, uuid, uuid, text, boolean, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_membership_change(uuid, uuid, uuid, text, boolean, text, timestamptz, jsonb) to service_role;
-- One membership path: the browser RPC from the local foundation is withdrawn.
-- (The hosted foundation never creates it, so this is conditional.)
do $$ begin
  if to_regprocedure('public.set_business_membership(uuid, uuid, text, boolean, text)') is not null then
    revoke all on function public.set_business_membership(uuid, uuid, text, boolean, text) from public, anon, authenticated, service_role;
  end if;
end $$;
