create table if not exists fleet_profiles (
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

create table if not exists personnel_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null check (role in ('Owner', 'Admin', 'Manager', 'Driver')),
  route text,
  shift_status text,
  avg_shift_revenue numeric(12, 2) default 0,
  cash_accuracy numeric(5, 2),
  prdp_expiry_date date,
  phone text,
  created_at timestamptz default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  registration text unique not null,
  model text not null,
  route text,
  assigned_driver_id uuid references personnel_profiles(id),
  current_odometer integer default 0,
  next_service_at integer,
  status text,
  utilisation integer default 0,
  defects_open integer default 0,
  permit_expiry_date date,
  disc_expiry_date date,
  created_at timestamptz default now()
);

create table if not exists shift_reconciliations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  driver_id uuid references personnel_profiles(id),
  route text,
  opening_odometer integer not null,
  closing_odometer integer not null,
  claimed_amount numeric(12, 2) not null,
  counted_amount numeric(12, 2),
  shortage_amount numeric(12, 2) generated always as
    (greatest(coalesce(claimed_amount, 0) - coalesce(counted_amount, 0), 0)) stored,
  gap_km integer generated always as
    (greatest(coalesce(closing_odometer, 0) - coalesce(opening_odometer, 0), 0)) stored,
  status text not null default 'Submitted',
  submitted_at timestamptz default now(),
  verified_at timestamptz,
  verified_by uuid references personnel_profiles(id),
  banking_event_id uuid
);

create table if not exists expense_entries (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  category text not null,
  amount numeric(12, 2) not null,
  notes text,
  incurred_at timestamptz default now(),
  banking_event_id uuid
);

create table if not exists banking_events (
  id uuid primary key default gen_random_uuid(),
  reference_code text unique not null,
  verified_takings numeric(12, 2) not null,
  cash_expenses numeric(12, 2) not null,
  deposit_amount numeric(12, 2) not null,
  locked_at timestamptz,
  locked_by uuid references personnel_profiles(id),
  created_at timestamptz default now()
);

alter table shift_reconciliations
  add constraint shift_reconciliations_banking_fk
  foreign key (banking_event_id) references banking_events(id);

alter table expense_entries
  add constraint expense_entries_banking_fk
  foreign key (banking_event_id) references banking_events(id);

create table if not exists defect_reports (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  reported_by uuid references personnel_profiles(id),
  severity text not null,
  issue text not null,
  status text not null default 'Open',
  cost_estimate numeric(12, 2),
  reported_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists compliance_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('vehicle', 'person')),
  subject_id uuid not null,
  document_type text not null,
  owner_role text not null,
  expiry_date date not null,
  stage text,
  action_required text,
  created_at timestamptz default now()
);

create or replace view compliance_dashboard as
select
  cd.id,
  cd.subject_type,
  cd.subject_id,
  cd.document_type,
  cd.owner_role,
  cd.expiry_date,
  (cd.expiry_date - current_date) as days_left,
  case
    when cd.expiry_date - current_date <= 30 then '30-day critical'
    when cd.expiry_date - current_date <= 60 then '60-day warning'
    else '90-day watch'
  end as stage
from compliance_documents cd;
