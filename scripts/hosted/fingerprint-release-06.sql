-- READ-ONLY fingerprint for release file 06. Run in production BEFORE applying
-- file 06 and again AFTER (and after any rollback); the two values must match.
-- File 06 must not change memberships (roles, activity, driver links), business
-- rows or workspace snapshots. Prints hashes and counts only (no data).
select
  (select count(*) from public.businesses) as businesses,
  (select count(*) from public.business_memberships) as memberships,
  (select count(*) from public.workspace_snapshots) as snapshots,
  (select md5(coalesce(string_agg(b.id::text || '|' || b.slug || '|' || b.name, ',' order by b.id), '')) from public.businesses b) as businesses_md5,
  (select md5(coalesce(string_agg(m.business_id::text || '|' || m.user_id::text || '|' || m.role || '|' || m.active::text || '|' || coalesce(m.driver_staff_id, ''), ',' order by m.business_id, m.user_id), '')) from public.business_memberships m) as memberships_md5,
  (select md5(coalesce(string_agg(w.business_id::text || '|' || md5(w.snapshot::text) || '|' || w.updated_at::text, ',' order by w.business_id), '')) from public.workspace_snapshots w) as snapshots_md5;
