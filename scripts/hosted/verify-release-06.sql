-- READ-ONLY post-check for release file 06 (member permissions). Run in
-- production right AFTER scripts/hosted/apply-release.mjs reports PASS, before
-- anyone changes a responsibility. Expected: every row ok = true.
-- (Checks 4-6 and 9 describe the state immediately after release; once Owners
-- start assigning responsibilities they legitimately change.)
select check_name, ok, detail from (
  select 1 as n, 'permissions column: text[], NOT NULL, no default' as check_name,
    count(*) = 1 as ok, string_agg(data_type || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, 'none'), '') as detail
  from information_schema.columns
  where table_schema = 'public' and table_name = 'business_memberships' and column_name = 'permissions'
    and data_type = 'ARRAY' and is_nullable = 'NO' and column_default is null
  union all
  select 2, 'known-keys and roles-only constraints present',
    count(*) = 2, string_agg(conname, ', ' order by conname)
  from pg_constraint where conrelid = 'public.business_memberships'::regclass
    and conname in ('business_memberships_permissions_known', 'business_memberships_permissions_roles')
  union all
  select 3, 'role-follow trigger present',
    count(*) = 1, null
  from pg_trigger where tgrelid = 'public.business_memberships'::regclass and tgname = 'business_memberships_permissions_follow_role' and not tgisinternal
  union all
  select 4, 'every Admin holds exactly {cash.count} (pre-06 rule kept)',
    count(*) filter (where not (permissions @> array['cash.count'] and permissions <@ array['cash.count'])) = 0,
    format('%s Admin row(s)', count(*))
  from public.business_memberships where role = 'Admin'
  union all
  select 5, 'every Manager holds exactly {cash.verify, cash.bank} (pre-06 rule kept)',
    count(*) filter (where not (permissions @> array['cash.verify', 'cash.bank'] and permissions <@ array['cash.verify', 'cash.bank'])) = 0,
    format('%s Manager row(s)', count(*))
  from public.business_memberships where role = 'Manager'
  union all
  select 6, 'Owners and Drivers hold no stored responsibilities',
    count(*) filter (where permissions <> '{}'::text[]) = 0,
    format('%s Owner/Driver row(s)', count(*))
  from public.business_memberships where role in ('Owner', 'Driver')
  union all
  select 7, 'set_member_permissions: executable by service_role only',
    bool_and(has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')) and count(*) = 1,
    null
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_member_permissions'
  union all
  select 8, 'audit table member_permission_changes: RLS on and forced, no browser grants',
    (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.member_permission_changes'::regclass)
      and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'member_permission_changes' and grantee in ('anon', 'authenticated', 'PUBLIC')),
    null
  union all
  select 9, 'audit table starts empty',
    (select count(*) from public.member_permission_changes) = 0,
    format('%s row(s)', (select count(*) from public.member_permission_changes))
  union all
  select 10, 'browser grants are still exactly authenticated SELECT on businesses and business_memberships',
    count(*) = 0, string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ')
  from information_schema.role_table_grants
  where table_schema = 'public'
    and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and not (table_name in ('businesses', 'business_memberships') and privilege_type = 'SELECT')))
  union all
  select 11, 'no public function executable by anon or authenticated',
    count(*) = 0, string_agg(p.oid::regprocedure::text, ', ')
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
) checks order by n;
