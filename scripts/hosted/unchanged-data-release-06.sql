-- READ-ONLY. Run in production immediately BEFORE and AFTER applying release
-- file 06, in a quiet window (no one capturing, counting or banking). Every value
-- must be identical before and after. File 06 intentionally changes only
-- business_memberships.permissions (new column, backfilled by role) and adds the
-- empty member_permission_changes table; neither is part of these hashes.
-- Prints counts and hashes only (no data). Extends fingerprint-release-06.sql
-- (which stays as recorded) with the request log, platform admins, membership
-- timestamps and Auth users.
select
  (select count(*) from public.businesses) as businesses,
  (select md5(coalesce(string_agg(to_jsonb(b)::text, ',' order by b.id), '')) from public.businesses b) as businesses_all_columns_md5,
  (select count(*) from public.business_memberships) as memberships,
  (select md5(coalesce(string_agg((to_jsonb(m) - 'permissions')::text, ',' order by m.business_id, m.user_id), '')) from public.business_memberships m) as memberships_except_permissions_md5,
  (select count(*) from public.workspace_snapshots) as snapshots,
  (select md5(coalesce(string_agg(to_jsonb(w)::text, ',' order by w.business_id), '')) from public.workspace_snapshots w) as snapshots_all_columns_md5,
  (select count(*) from public.finance_action_requests) as finance_requests,
  (select md5(coalesce(string_agg(to_jsonb(f)::text, ',' order by f.business_id, f.request_id), '')) from public.finance_action_requests f) as finance_requests_md5,
  (select count(*) from public.platform_admins) as platform_admins,
  (select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.user_id), '')) from public.platform_admins p) as platform_admins_md5,
  (select count(*) from auth.users) as auth_users,
  (select md5(coalesce(string_agg(u.id::text || '|' || coalesce(u.email, '') || '|' || coalesce(u.encrypted_password, '') || '|' || coalesce(u.banned_until::text, ''), ',' order by u.id), '')) from auth.users u) as auth_users_md5;
