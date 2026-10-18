-- Platform administration (hosted release file 05). Deployable unchanged.
--
-- A platform admin may create companies (businesses) and onboard each company's
-- initial Owner through the app. It is an EXPLICIT grant, separate from business
-- memberships:
-- * it grants NO access to any company's data (workspace snapshots, members,
--   reports, finance): that still needs an active business membership;
-- * rows are written only by the operator (postgres); there is no browser,
--   API or service-role write path, so nobody can grant it to themselves;
-- * the server reads it with the service role only after validating the
--   caller's access token, and only for the caller's own user id.
-- Idempotent.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  granted_by text not null default 'operator',
  note text
);

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

-- No browser access of any kind (RLS does not govern TRUNCATE/REFERENCES/TRIGGER).
revoke all on table public.platform_admins from public, anon, authenticated;
-- The server only needs to read the caller's own row; writes stay with the operator.
revoke all on table public.platform_admins from service_role;
grant select on table public.platform_admins to service_role;
-- No policies: browser roles have no grants, and the service role bypasses RLS.
drop policy if exists "server reads platform admins" on public.platform_admins;
