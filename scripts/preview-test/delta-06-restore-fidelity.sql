-- Isolated Preview TEST project ONLY (taxiflow-preview-test, sxoonhovoqgcpflhqirb).
-- Brings its release-06 objects in line with the final file 06 (2026-10-19
-- restore-fidelity fix). Production gets the final file 06 itself, not this.
-- Changes: the permissions column loses its default, and the insert trigger
-- fills role defaults only when permissions is NULL, so an explicit list
-- (including an Owner-emptied one) is kept by inserts such as a backup restore.
-- No data, accounts or credentials. Safe to re-run.
begin;

do $$ begin
  if to_regclass('public.business_memberships') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'business_memberships' and column_name = 'permissions') then
    raise exception 'Refusing: this project does not have release file 06.';
  end if;
  if not exists (select 1 from public.businesses where slug in ('preview-company-a', 'preview-company-b')) then
    raise exception 'Refusing: this is not the seeded Preview test project.';
  end if;
end $$;

create or replace function taxiflow_private.member_permissions_follow_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.permissions is null then
      new.permissions := taxiflow_private.default_member_permissions(new.role);
    end if;
  elsif new.role is distinct from old.role then
    new.permissions := taxiflow_private.default_member_permissions(new.role);
  end if;
  return new;
end;
$$;
revoke all on function taxiflow_private.member_permissions_follow_role() from public, anon, authenticated;

alter table public.business_memberships alter column permissions drop default;

commit;

-- Verify (read-only): expect column_default null and the trigger function body containing "is null then".
-- select column_default from information_schema.columns where table_schema='public' and table_name='business_memberships' and column_name='permissions';
