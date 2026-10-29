-- READ-ONLY verification for scripts/preview-test/schema.sql on the isolated
-- Preview test project (sxoonhovoqgcpflhqirb). Changes nothing.
-- Expected: every row shows ok = true.
select check_name, ok, detail from (
  select 1 as n, 'schema present: the 6 TaxiFlow tables' as check_name,
    count(*) = 6 as ok, string_agg(table_name, ', ' order by table_name) as detail
  from information_schema.tables
  where table_schema = 'public' and table_name in ('workspace_snapshots', 'businesses', 'business_memberships', 'finance_action_requests', 'platform_admins', 'member_permission_changes')
  union all
  select 2, 'release 06 column present (business_memberships.permissions)',
    count(*) = 1, null
  from information_schema.columns where table_schema = 'public' and table_name = 'business_memberships' and column_name = 'permissions'
  union all
  select 3, 'every public table has RLS on',
    count(*) filter (where not c.relrowsecurity) = 0, string_agg(c.relname, ', ') filter (where not c.relrowsecurity)
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 4, 'browser grants: only SELECT on businesses and business_memberships for authenticated',
    count(*) = 0, string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ')
  from information_schema.role_table_grants
  where table_schema = 'public'
    and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and not (table_name in ('businesses', 'business_memberships') and privilege_type = 'SELECT')))
  union all
  select 5, 'no public function executable by anon or authenticated',
    count(*) = 0, string_agg(p.oid::regprocedure::text, ', ')
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  union all
  select 6, 'server functions executable by service_role',
    count(*) = 5, string_agg(p.proname, ', ' order by p.proname)
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname in ('commit_finance_action', 'create_business_with_owner', 'apply_membership_change', 'assign_initial_owner', 'set_member_permissions')
    and has_function_privilege('service_role', p.oid, 'execute')
  union all
  select 7, 'no policies on workspace_snapshots (server-only table)',
    count(*) = 0, string_agg(policyname, ', ')
  from pg_policies where schemaname = 'public' and tablename = 'workspace_snapshots'
  union all
  select 8, 'platform_admins and member_permission_changes: RLS forced',
    count(*) = 2, string_agg(relname, ', ')
  from pg_class where relnamespace = 'public'::regnamespace and relname in ('platform_admins', 'member_permission_changes') and relforcerowsecurity
  union all
  select 9, 'no data and no accounts were created',
    (select count(*) from auth.users) = 0 and (select count(*) from public.businesses) = 0 and (select count(*) from public.workspace_snapshots) = 0,
    format('users=%s businesses=%s snapshots=%s', (select count(*) from auth.users), (select count(*) from public.businesses), (select count(*) from public.workspace_snapshots))
  union all
  select 10, 'no temporary or local-only objects (taxiflow_local schema absent)',
    to_regnamespace('taxiflow_local') is null, null
) checks order by n;
