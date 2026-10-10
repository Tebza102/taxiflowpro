-- Scoped server writes for finance/cash-up actions (LOCAL; never applied to a
-- hosted project from here). Idempotency log + one atomic commit function that
-- the server calls with the service role AFTER tenant authorization.

create table if not exists public.finance_action_requests (
  business_id uuid not null references public.businesses (id) on delete restrict,
  request_id uuid not null,
  user_id uuid not null references auth.users (id),
  action text not null,
  target_id text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id, request_id)
);

alter table public.finance_action_requests enable row level security;
revoke all on table public.finance_action_requests from public, anon, authenticated;

-- One transaction: replay check, compare-and-swap on updated_at, request log.
-- A stale p_expected_updated_at changes nothing and returns 'conflict'.
create or replace function public.commit_finance_action(
  p_business_id uuid,
  p_expected_updated_at timestamptz,
  p_snapshot jsonb,
  p_updated_by uuid,
  p_request_id uuid,
  p_action text,
  p_target_id text,
  p_request_hash text,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.finance_action_requests;
  v_version timestamptz := clock_timestamp();
  v_rows integer;
begin
  select * into v_existing from public.finance_action_requests
  where business_id = p_business_id and request_id = p_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash or v_existing.user_id <> p_updated_by then
      return jsonb_build_object('status', 'request_id_reused');
    end if;
    return jsonb_build_object('status', 'replayed', 'response', v_existing.response);
  end if;

  update public.workspace_snapshots
  set snapshot = p_snapshot, updated_at = v_version, updated_by = p_updated_by
  where business_id = p_business_id and updated_at = p_expected_updated_at;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'conflict');
  end if;

  insert into public.finance_action_requests (business_id, request_id, user_id, action, target_id, request_hash, response)
  values (p_business_id, p_request_id, p_updated_by, p_action, p_target_id, p_request_hash,
          p_response || jsonb_build_object('version', v_version));

  return jsonb_build_object('status', 'applied', 'version', v_version, 'response', p_response || jsonb_build_object('version', v_version));
end;
$$;

revoke all on function public.commit_finance_action(uuid, timestamptz, jsonb, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.commit_finance_action(uuid, timestamptz, jsonb, uuid, uuid, text, text, text, jsonb) to service_role;
