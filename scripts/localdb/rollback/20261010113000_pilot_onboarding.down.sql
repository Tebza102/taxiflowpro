-- Rollback of 20261010113000_pilot_onboarding.sql (LOCAL only; NOT A PRODUCTION
-- RECOVERY PROCEDURE). Businesses, memberships and snapshots created through the
-- onboarding functions are kept; only the functions and the Owner guard go.
-- The foundation's browser RPC grant is restored as it was before this migration.
drop trigger if exists business_memberships_keep_owner on public.business_memberships;
drop function if exists taxiflow_private.keep_an_active_owner();
drop function if exists public.create_business_with_owner(text, text, uuid, text, jsonb);
drop function if exists public.apply_membership_change(uuid, uuid, uuid, text, boolean, text, timestamptz, jsonb);
grant execute on function public.set_business_membership(uuid, uuid, text, boolean, text) to authenticated;
