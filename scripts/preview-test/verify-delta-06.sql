-- Isolated Preview TEST project ONLY (taxiflow-preview-test, sxoonhovoqgcpflhqirb).
-- Targeted check that the test backend follows the FINAL file 06 membership-
-- insert rule (after scripts/preview-test/delta-06-restore-fidelity.sql).
-- Part A is read-only. Part B changes nothing: it always ends by raising, which
-- rolls back everything it did; the result is in the error message.

-- Part A (read-only). Expected: both rows ok = true.
select 'permissions column has no default' as check_name,
  column_default is null as ok, coalesce(column_default, 'none') as detail
from information_schema.columns
where table_schema = 'public' and table_name = 'business_memberships' and column_name = 'permissions'
union all
select 'insert trigger fills defaults only for NULL',
  position('if new.permissions is null then' in pg_get_functiondef('taxiflow_private.member_permissions_follow_role()'::regprocedure)) > 0
    and position('new.permissions = ''{}''' in pg_get_functiondef('taxiflow_private.member_permissions_follow_role()'::regprocedure)) = 0,
  null;

-- Part B (behaviour, always rolled back). Run on its own.
-- Expected: ERROR "PASS (rolled back): emptied Admin kept {} after re-insert; omitted list got {cash.count}".
do $$
declare
  v_business uuid;
  v_admin uuid;
  v_row jsonb;
  v_after text[];
  v_omitted text[];
begin
  select id into v_business from public.businesses where slug = 'preview-company-a';
  select user_id into v_admin from public.business_memberships where business_id = v_business and role = 'Admin' and active limit 1;
  if v_admin is null then raise exception 'FAIL: no Admin in preview-company-a (is this the seeded test project?)'; end if;
  update public.business_memberships set permissions = '{}' where business_id = v_business and user_id = v_admin;
  select to_jsonb(m) into v_row from public.business_memberships m where business_id = v_business and user_id = v_admin;
  delete from public.business_memberships where business_id = v_business and user_id = v_admin;
  insert into public.business_memberships select (jsonb_populate_record(null::public.business_memberships, v_row)).*;
  select permissions into v_after from public.business_memberships where business_id = v_business and user_id = v_admin;
  delete from public.business_memberships where business_id = v_business and user_id = v_admin;
  insert into public.business_memberships (business_id, user_id, role, active) values (v_business, v_admin, 'Admin', true);
  select permissions into v_omitted from public.business_memberships where business_id = v_business and user_id = v_admin;
  if v_after = '{}'::text[] and v_omitted = array['cash.count'] then
    raise exception 'PASS (rolled back): emptied Admin kept {} after re-insert; omitted list got {cash.count}';
  end if;
  raise exception 'FAIL (rolled back): after re-insert %, omitted list %', v_after, v_omitted;
end $$;
