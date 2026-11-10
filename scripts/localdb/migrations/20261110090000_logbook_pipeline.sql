-- Paper logbook import: review queue, audit log and automation keys (LOCAL;
-- never applied to a hosted project from here). Nothing in these tables is live
-- business data: a row reaches workspace_snapshots only through
-- commit_logbook_approval, after an Owner/Admin approved it on the server.
-- No browser access at all: every read and write goes through the server with
-- the service role, after tenant authorization, pinned to one business.

create table if not exists public.logbook_api_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scope text not null default 'logbook.import' check (scope = 'logbook.import'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  last_used_at timestamptz
);

create table if not exists public.logbook_api_key_usage (
  key_id uuid not null references public.logbook_api_keys (id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (key_id, window_start)
);

create table if not exists public.logbook_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  source text not null check (source in ('upload', 'api')),
  model text,
  reference text,
  created_by uuid references auth.users (id),
  api_key_id uuid references public.logbook_api_keys (id),
  created_at timestamptz not null default now(),
  check ((source = 'upload' and created_by is not null) or (source = 'api' and api_key_id is not null))
);

create table if not exists public.logbook_pages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  batch_id uuid not null references public.logbook_batches (id) on delete restrict,
  page_number integer not null,
  filename text,
  media_type text not null check (media_type in ('image/jpeg', 'image/png')),
  byte_size integer not null,
  sha256 text not null,
  image_base64 text not null,
  page_note text,
  created_at timestamptz not null default now(),
  -- The same photo is stored once per business; a re-upload returns the first batch.
  unique (business_id, sha256)
);

create table if not exists public.logbook_rows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  batch_id uuid not null references public.logbook_batches (id) on delete restrict,
  page_id uuid references public.logbook_pages (id) on delete restrict,
  row_index integer not null,
  fields jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  row_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  edited_by uuid references auth.users (id),
  edited_at timestamptz,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  reject_reason text,
  live_record_ids jsonb,
  created_at timestamptz not null default now()
);

-- Duplicate guard: one pending-or-approved row per business and row hash
-- (driver + vehicle + date + amounts). A rejected row does not block a re-import.
create unique index if not exists logbook_rows_active_hash
  on public.logbook_rows (business_id, row_hash) where status <> 'rejected';
create index if not exists logbook_rows_batch on public.logbook_rows (business_id, batch_id, row_index);

-- Who extracted, imported, edited, approved or rejected each row. Append-only.
create table if not exists public.logbook_row_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  batch_id uuid not null references public.logbook_batches (id) on delete restrict,
  row_id uuid not null references public.logbook_rows (id) on delete restrict,
  action text not null check (action in ('extracted', 'imported', 'edited', 'approved', 'rejected')),
  actor_user_id uuid references auth.users (id),
  actor_api_key_id uuid references public.logbook_api_keys (id),
  actor_role text,
  before_fields jsonb,
  after_fields jsonb,
  detail text,
  created_at timestamptz not null default now(),
  check (actor_user_id is not null or actor_api_key_id is not null)
);
create index if not exists logbook_row_events_row on public.logbook_row_events (business_id, row_id, id);

alter table public.logbook_api_keys enable row level security;
alter table public.logbook_api_key_usage enable row level security;
alter table public.logbook_batches enable row level security;
alter table public.logbook_pages enable row level security;
alter table public.logbook_rows enable row level security;
alter table public.logbook_row_events enable row level security;
revoke all on table public.logbook_api_keys, public.logbook_api_key_usage, public.logbook_batches,
  public.logbook_pages, public.logbook_rows, public.logbook_row_events from public, anon, authenticated;
grant select, insert, update, delete on table public.logbook_api_keys, public.logbook_api_key_usage, public.logbook_batches,
  public.logbook_pages, public.logbook_rows, public.logbook_row_events to service_role;

-- Queue extracted or imported rows as PENDING, in one transaction.
--   p_pages: [{ page_number, filename, media_type, byte_size, sha256, image_base64, page_note }]
--   p_rows:  [{ page_index (into p_pages) | null, row_index, fields, issues, row_hash }]
-- A row whose hash already exists (pending or approved) in the business is
-- skipped, so sending the same rows again adds nothing.
create or replace function public.logbook_queue(
  p_business_id uuid,
  p_source text,
  p_model text,
  p_reference text,
  p_user_id uuid,
  p_role text,
  p_api_key_id uuid,
  p_batch_id uuid,
  p_pages jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid := p_batch_id;
  v_new_batch boolean := false;
  v_page jsonb;
  v_row jsonb;
  v_page_ids uuid[] := '{}';
  v_page_id uuid;
  v_row_id uuid;
  v_existing public.logbook_rows;
  v_inserted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_base integer;
begin
  if v_batch_id is not null then
    perform 1 from public.logbook_batches
      where id = v_batch_id and business_id = p_business_id and source = p_source;
    if not found then
      return jsonb_build_object('status', 'batch_not_found');
    end if;
  else
    insert into public.logbook_batches (business_id, source, model, reference, created_by, api_key_id)
    values (p_business_id, p_source, p_model, p_reference, p_user_id, p_api_key_id)
    returning id into v_batch_id;
    v_new_batch := true;
  end if;

  select coalesce(max(page_number), 0) into v_base from public.logbook_pages where batch_id = v_batch_id;
  for v_page in select * from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) loop
    v_base := v_base + 1;
    insert into public.logbook_pages (business_id, batch_id, page_number, filename, media_type, byte_size, sha256, image_base64, page_note)
    values (p_business_id, v_batch_id, v_base, v_page->>'filename', v_page->>'media_type', (v_page->>'byte_size')::integer,
            v_page->>'sha256', v_page->>'image_base64', v_page->>'page_note')
    returning id into v_page_id;
    v_page_ids := v_page_ids || v_page_id;
  end loop;

  select coalesce(max(row_index), 0) into v_base from public.logbook_rows where batch_id = v_batch_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_page_id := case when v_row->>'page_index' is null then null else v_page_ids[(v_row->>'page_index')::integer + 1] end;
    v_row_id := null;
    insert into public.logbook_rows (business_id, batch_id, page_id, row_index, fields, issues, row_hash)
    values (p_business_id, v_batch_id, v_page_id, v_base + 1, v_row->'fields', coalesce(v_row->'issues', '[]'::jsonb), v_row->>'row_hash')
    on conflict (business_id, row_hash) where status <> 'rejected' do nothing
    returning id into v_row_id;
    if v_row_id is null then
      select * into v_existing from public.logbook_rows
        where business_id = p_business_id and row_hash = v_row->>'row_hash' and status <> 'rejected';
      v_skipped := v_skipped || jsonb_build_object(
        'rowIndex', (v_row->>'row_index')::integer, 'existingRowId', v_existing.id,
        'existingBatchId', v_existing.batch_id, 'existingStatus', v_existing.status);
    else
      v_base := v_base + 1;
      v_inserted := v_inserted || to_jsonb(v_row_id);
      insert into public.logbook_row_events (business_id, batch_id, row_id, action, actor_user_id, actor_api_key_id, actor_role, after_fields)
      values (p_business_id, v_batch_id, v_row_id, case when p_source = 'api' then 'imported' else 'extracted' end,
              p_user_id, p_api_key_id, p_role, v_row->'fields');
    end if;
  end loop;

  -- An import that added nothing leaves no empty batch behind.
  if v_new_batch and jsonb_array_length(v_inserted) = 0 and coalesce(array_length(v_page_ids, 1), 0) = 0 then
    delete from public.logbook_batches where id = v_batch_id;
    v_batch_id := null;
  end if;

  return jsonb_build_object('status', 'queued', 'batchId', v_batch_id, 'pageIds', to_jsonb(v_page_ids),
                            'insertedRowIds', v_inserted, 'skipped', v_skipped);
end;
$$;

-- Admin edit of a PENDING row (fields, issues and hash recomputed by the server).
create or replace function public.logbook_edit_row(
  p_business_id uuid,
  p_row_id uuid,
  p_user_id uuid,
  p_role text,
  p_fields jsonb,
  p_issues jsonb,
  p_row_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.logbook_rows;
begin
  select * into v_row from public.logbook_rows where id = p_row_id and business_id = p_business_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status <> 'pending' then return jsonb_build_object('status', 'not_pending', 'rowStatus', v_row.status); end if;
  begin
    update public.logbook_rows
      set fields = p_fields, issues = p_issues, row_hash = p_row_hash, edited_by = p_user_id, edited_at = clock_timestamp()
      where id = p_row_id;
  exception when unique_violation then
    return jsonb_build_object('status', 'duplicate');
  end;
  insert into public.logbook_row_events (business_id, batch_id, row_id, action, actor_user_id, actor_role, before_fields, after_fields)
  values (p_business_id, v_row.batch_id, p_row_id, 'edited', p_user_id, p_role, v_row.fields, p_fields);
  return jsonb_build_object('status', 'edited');
end;
$$;

-- Reject keeps the row and its history; nothing is written to live data.
create or replace function public.logbook_reject_row(
  p_business_id uuid,
  p_row_id uuid,
  p_user_id uuid,
  p_role text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.logbook_rows;
begin
  select * into v_row from public.logbook_rows where id = p_row_id and business_id = p_business_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status <> 'pending' then return jsonb_build_object('status', 'not_pending', 'rowStatus', v_row.status); end if;
  update public.logbook_rows
    set status = 'rejected', reviewed_by = p_user_id, reviewed_at = clock_timestamp(), reject_reason = p_reason
    where id = p_row_id;
  insert into public.logbook_row_events (business_id, batch_id, row_id, action, actor_user_id, actor_role, before_fields, detail)
  values (p_business_id, v_row.batch_id, p_row_id, 'rejected', p_user_id, p_role, v_row.fields, p_reason);
  return jsonb_build_object('status', 'rejected');
end;
$$;

-- Approve: ONE transaction that (1) locks the pending row and checks it is still
-- the content the server validated, (2) compare-and-swaps the business snapshot
-- (the live records), (3) marks the row approved and (4) writes the audit event.
-- Any failed check changes nothing.
create or replace function public.commit_logbook_approval(
  p_business_id uuid,
  p_row_id uuid,
  p_expected_row_hash text,
  p_expected_updated_at timestamptz,
  p_snapshot jsonb,
  p_user_id uuid,
  p_role text,
  p_live_record_ids jsonb,
  p_issues jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.logbook_rows;
  v_version timestamptz := clock_timestamp();
  v_rows integer;
begin
  select * into v_row from public.logbook_rows where id = p_row_id and business_id = p_business_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status <> 'pending' then return jsonb_build_object('status', 'not_pending', 'rowStatus', v_row.status); end if;
  if v_row.row_hash <> p_expected_row_hash then return jsonb_build_object('status', 'row_changed'); end if;

  update public.workspace_snapshots
    set snapshot = p_snapshot, updated_at = v_version, updated_by = p_user_id
    where business_id = p_business_id and updated_at = p_expected_updated_at;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('status', 'conflict'); end if;

  update public.logbook_rows
    set status = 'approved', reviewed_by = p_user_id, reviewed_at = v_version, live_record_ids = p_live_record_ids, issues = p_issues
    where id = p_row_id;
  insert into public.logbook_row_events (business_id, batch_id, row_id, action, actor_user_id, actor_role, after_fields, detail)
  values (p_business_id, v_row.batch_id, p_row_id, 'approved', p_user_id, p_role, v_row.fields, p_live_record_ids::text);
  return jsonb_build_object('status', 'approved', 'version', v_version);
end;
$$;

-- Fixed-window rate limit for one automation key. Returns true when the request
-- is within the limit; also stamps last_used_at.
create or replace function public.logbook_rate_take(p_key_id uuid, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  delete from public.logbook_api_key_usage where key_id = p_key_id and window_start < v_window - interval '1 day';
  insert into public.logbook_api_key_usage (key_id, window_start, request_count)
  values (p_key_id, v_window, 1)
  on conflict (key_id, window_start) do update set request_count = public.logbook_api_key_usage.request_count + 1
  returning request_count into v_count;
  update public.logbook_api_keys set last_used_at = clock_timestamp() where id = p_key_id;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.logbook_queue(uuid, text, text, text, uuid, text, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.logbook_edit_row(uuid, uuid, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.logbook_reject_row(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.commit_logbook_approval(uuid, uuid, text, timestamptz, jsonb, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.logbook_rate_take(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.logbook_queue(uuid, text, text, text, uuid, text, uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.logbook_edit_row(uuid, uuid, uuid, text, jsonb, jsonb, text) to service_role;
grant execute on function public.logbook_reject_row(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.commit_logbook_approval(uuid, uuid, text, timestamptz, jsonb, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.logbook_rate_take(uuid, integer, integer) to service_role;
