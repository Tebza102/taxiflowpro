-- LOCAL REHEARSAL ONLY: exact copy of the LIVE public schema as inventoried
-- read-only on 2026-10-10 (project vfxftviwteypasredjgm, PostgreSQL 17.6),
-- including its insecure access, so the hosted foundation migration can be
-- rehearsed against what production really has. Schema only; no live data.
-- Never apply to a hosted project. Inventory: project-os/05-build/hosted-inventory.md.

-- 1. workspace_snapshots (the only table the app uses)
create table public.workspace_snapshots (
  workspace_key text primary key,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
alter table public.workspace_snapshots enable row level security;
create policy "Authenticated users can read workspace snapshots"
  on public.workspace_snapshots for select to authenticated using (true);
create policy "Authenticated users can insert workspace snapshots"
  on public.workspace_snapshots for insert to authenticated with check (true);
create policy "Authenticated users can update workspace snapshots"
  on public.workspace_snapshots for update to authenticated using (true) with check (true);

-- 2. The eight unused legacy tables: RLS DISABLED on live.
create table public.fleet_profiles (
  id uuid primary key default gen_random_uuid(),
  fleet_name text not null,
  legal_entity text not null,
  district text not null,
  install_readiness text default 'PWA Ready',
  next_banking_window text,
  service_interval_km integer default 10000,
  monthly_target numeric(12, 2),
  created_at timestamptz default now()
);
create table public.personnel_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null check (role = any (array['Owner', 'Admin', 'Manager', 'Driver'])),
  route text,
  shift_status text,
  avg_shift_revenue numeric(12, 2) default 0,
  cash_accuracy numeric(5, 2),
  prdp_expiry_date date,
  phone text,
  created_at timestamptz default now()
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  registration text not null unique,
  model text not null,
  route text,
  assigned_driver_id uuid references public.personnel_profiles (id),
  current_odometer integer default 0,
  next_service_at integer,
  status text,
  utilisation integer default 0,
  defects_open integer default 0,
  permit_expiry_date date,
  disc_expiry_date date,
  created_at timestamptz default now()
);
create table public.banking_events (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  verified_takings numeric(12, 2) not null,
  cash_expenses numeric(12, 2) not null,
  deposit_amount numeric(12, 2) not null,
  locked_at timestamptz,
  locked_by uuid references public.personnel_profiles (id),
  created_at timestamptz default now()
);
create table public.shift_reconciliations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id),
  driver_id uuid references public.personnel_profiles (id),
  route text,
  opening_odometer integer not null,
  closing_odometer integer not null,
  claimed_amount numeric(12, 2) not null,
  counted_amount numeric(12, 2),
  shortage_amount numeric(12, 2),
  gap_km integer,
  status text not null default 'Submitted',
  submitted_at timestamptz default now(),
  verified_at timestamptz,
  verified_by uuid references public.personnel_profiles (id),
  banking_event_id uuid,
  constraint shift_reconciliations_banking_fk foreign key (banking_event_id) references public.banking_events (id)
);
create table public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id),
  category text not null,
  amount numeric(12, 2) not null,
  notes text,
  incurred_at timestamptz default now(),
  banking_event_id uuid,
  constraint expense_entries_banking_fk foreign key (banking_event_id) references public.banking_events (id)
);
create table public.defect_reports (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id),
  reported_by uuid references public.personnel_profiles (id),
  severity text not null,
  issue text not null,
  status text not null default 'Open',
  cost_estimate numeric(12, 2),
  reported_at timestamptz default now(),
  resolved_at timestamptz
);
create table public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type = any (array['vehicle', 'person'])),
  subject_id uuid not null,
  document_type text not null,
  owner_role text not null,
  expiry_date date not null,
  stage text,
  action_required text,
  created_at timestamptz default now()
);

-- 3. The view (no security_invoker option on live: it runs as its owner).
create view public.compliance_dashboard as
select id, subject_type, subject_id, document_type, owner_role, expiry_date,
  expiry_date - current_date as days_left,
  case
    when (expiry_date - current_date) <= 30 then '30-day critical'
    when (expiry_date - current_date) <= 60 then '60-day warning'
    else '90-day watch'
  end as stage
from public.compliance_documents cd;

-- 4. Live grants: anon and authenticated hold EVERY privilege (incl. TRUNCATE)
--    on all ten relations; live default privileges grant the same on new objects.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname <> 'instance' loop
    execute format('grant all on table public.%I to anon, authenticated, service_role', r.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
