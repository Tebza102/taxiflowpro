-- === Hosted access section (replaces the local grants/RLS section) =============

-- Every policy on workspace_snapshots (live: "Authenticated users can
-- read/insert/update workspace snapshots"), whatever it is called.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'workspace_snapshots' loop
    execute format('drop policy %I on public.workspace_snapshots', p.policyname);
  end loop;
end $$;

-- Every privilege anon, authenticated and PUBLIC hold on any public relation
-- (tables, views, sequences), then RLS on every public table.
do $$
declare r record;
begin
  for r in
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence public.%I from anon, authenticated, public', r.relname);
    else
      execute format('revoke all on table public.%I from anon, authenticated, public', r.relname);
    end if;
    if r.relkind in ('r', 'p') then
      execute format('alter table public.%I enable row level security', r.relname);
    end if;
  end loop;
end $$;

-- The legacy view must not run with its owner's rights.
alter view if exists public.compliance_dashboard set (security_invoker = true);

-- Every public function: no execute for anon, authenticated or PUBLIC (live has
-- none today; this also covers anything added since the inventory).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from anon, authenticated, public', f.sig);
  end loop;
end $$;

-- Live default privileges hand anon/authenticated everything on new objects
-- created by postgres in public. Remove them. (TaxiFlow never creates objects
-- as supabase_admin; explicit revokes in every migration still apply.)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

-- The only browser access the tenant model needs: read your own memberships and
-- businesses (RLS limits the rows). Everything else goes through the server.
grant select on table public.businesses to authenticated;
grant select on table public.business_memberships to authenticated;

revoke all on function taxiflow_private.is_active_member(uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function taxiflow_private.forbid_tenant_reassignment() from public, anon, authenticated;
grant usage on schema taxiflow_private to authenticated;
grant execute on function taxiflow_private.is_active_member(uuid, text[]) to authenticated;

drop policy if exists "members read their businesses" on public.businesses;
create policy "members read their businesses" on public.businesses
  for select to authenticated
  using (taxiflow_private.is_active_member(id));

drop policy if exists "read own or administered memberships" on public.business_memberships;
create policy "read own or administered memberships" on public.business_memberships
  for select to authenticated
  using (
    (user_id = auth.uid() and active)
    or taxiflow_private.is_active_member(business_id, array['Owner', 'Admin'])
  );

-- --- Assertions (any failure aborts and rolls back this migration) ----------------
do $$
declare
  leftover text;
begin
  select string_agg(policyname, ', ') into leftover
  from pg_policies where schemaname = 'public' and tablename = 'workspace_snapshots';
  if leftover is not null then raise exception 'Policies remain on workspace_snapshots: %', leftover; end if;

  select string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ' order by table_name, grantee, privilege_type) into leftover
  from information_schema.role_table_grants
  where table_schema = 'public'
    and (grantee in ('anon', 'PUBLIC')
         or (grantee = 'authenticated' and not (table_name in ('businesses', 'business_memberships') and privilege_type = 'SELECT')));
  if leftover is not null then raise exception 'Browser grants remain: %', leftover; end if;

  select string_agg(c.relname, ', ') into leftover
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if leftover is not null then raise exception 'Tables without RLS: %', leftover; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into leftover
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if leftover is not null then raise exception 'Browser-executable public functions: %', leftover; end if;

  if not exists (
    select 1 from public.business_memberships m
    where m.business_id = '10000000-0000-4000-8000-00000000000a' and m.role = 'Owner' and m.active
  ) then
    raise exception 'The existing workspace would have no active Owner; stop and add the operator Owner step first.';
  end if;
end $$;
