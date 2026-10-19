-- Rollback of 20261019090000_member_permissions.sql (release file 06).
-- Roll back the APPLICATION first (re-promote the previous deployment): the
-- release-06 code reads business_memberships.permissions; the previous code does
-- not and keeps working with or without the column.
-- Effect: per-member responsibilities are discarded; the previous fixed role
-- rules apply again (Admin counts; Manager verifies and banks). Memberships,
-- roles, driver links and snapshots are kept unchanged.
-- public.member_permission_changes (the audit of past changes) is deliberately
-- KEPT: it is inert without the function, and audit history should survive a
-- rollback. Drop it by hand only if that history must go.
drop function if exists public.set_member_permissions(uuid, uuid, uuid, text[], timestamptz, jsonb);
drop trigger if exists business_memberships_permissions_follow_role on public.business_memberships;
drop function if exists taxiflow_private.member_permissions_follow_role();
alter table public.business_memberships drop constraint if exists business_memberships_permissions_roles;
alter table public.business_memberships drop constraint if exists business_memberships_permissions_known;
alter table public.business_memberships drop column if exists permissions;
drop function if exists taxiflow_private.default_member_permissions(text);
