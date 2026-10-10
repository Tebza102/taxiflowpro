-- Operator: assign the INITIAL Owner of an EXISTING business (e.g. the mapped
-- legacy workspace when the directory backfill produced no active Owner).
-- Deployable unchanged (hosted release file 04). Idempotent. service_role only.
--
-- Refuses when the business already has an active Owner: replacing or adding
-- Owners of a running business is not an operator shortcut. The membership and
-- the business directory entry change in one transaction, and the directory
-- write only applies if the snapshot is still at p_expected_updated_at.
create or replace function public.assign_initial_owner(
  p_business_id uuid,
  p_user_id uuid,
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
  v_existing public.business_memberships;
  v_version timestamptz := clock_timestamp();
  v_rows integer;
begin
  if not exists (select 1 from public.businesses where id = p_business_id) then
    return jsonb_build_object('status', 'no_business');
  end if;
  -- Serialize with other Owner changes for this business.
  perform 1 from public.businesses where id = p_business_id for update;

  select * into v_existing from public.business_memberships
  where business_id = p_business_id and user_id = p_user_id;
  if found and v_existing.role = 'Owner' and v_existing.active then
    return jsonb_build_object('status', 'already_owner');
  end if;
  if exists (
    select 1 from public.business_memberships
    where business_id = p_business_id and role = 'Owner' and active
  ) then
    return jsonb_build_object('status', 'has_owner');
  end if;

  if p_snapshot is not null then
    update public.workspace_snapshots
    set snapshot = p_snapshot, updated_at = v_version, updated_by = p_user_id
    where business_id = p_business_id and updated_at = p_expected_updated_at;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('status', 'conflict');
    end if;
  end if;

  insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active, updated_by)
  values (p_business_id, p_user_id, 'Owner', nullif(trim(p_driver_staff_id), ''), true, p_user_id)
  on conflict (business_id, user_id) do update
    set role = 'Owner',
        driver_staff_id = coalesce(excluded.driver_staff_id, public.business_memberships.driver_staff_id),
        active = true,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return jsonb_build_object('status', 'assigned', 'version', v_version);
end;
$$;

revoke all on function public.assign_initial_owner(uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.assign_initial_owner(uuid, uuid, text, timestamptz, jsonb) to service_role;
