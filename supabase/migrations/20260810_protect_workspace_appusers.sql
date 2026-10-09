-- Protects workspace_snapshots.snapshot->'appUsers' from being modified by normal
-- authenticated clients. Account membership (who exists, what role they have,
-- whether they're active) must go through the server-side user lifecycle API
-- (api/_lib/userLifecycle.js), which uses the Supabase service-role key and
-- coordinates the change with Supabase Auth so the two stores cannot drift apart.
--
-- This does NOT restrict any other part of the snapshot (finance, fleet, drivers,
-- audit trail, etc.) - those continue to persist exactly as before for normal
-- authenticated clients. Only the appUsers sub-tree of an EXISTING row is guarded;
-- inserting a brand-new workspace row is unaffected, since there is no prior
-- appUsers value for a non-service-role client to have tampered with.

create or replace function public.protect_workspace_appusers()
returns trigger
language plpgsql
as $$
begin
  -- The server lifecycle API authenticates with the service-role key, which is
  -- exempt from this guard. Everything else (including any other authenticated
  -- client that can currently write to this table) is restricted.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if (coalesce(old.snapshot -> 'appUsers', '[]'::jsonb)) is distinct from
       (coalesce(new.snapshot -> 'appUsers', '[]'::jsonb)) then
      raise exception
        'workspace_snapshots.snapshot.appUsers can only be changed through the TaxiFlow account lifecycle API'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_workspace_appusers_trigger on public.workspace_snapshots;

create trigger protect_workspace_appusers_trigger
  before insert or update on public.workspace_snapshots
  for each row
  execute function public.protect_workspace_appusers();
