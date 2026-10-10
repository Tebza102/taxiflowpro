-- Identity marker that only the dedicated LOCAL TaxiFlow test database has.
-- Local tooling (scripts/localdb) refuses to reset, seed, export or restore
-- unless this exact row is present. A hosted project never has it.
create schema if not exists taxiflow_local;

create table taxiflow_local.instance (
  id text primary key,
  created_at timestamptz not null default now()
);

insert into taxiflow_local.instance (id) values ('taxiflow-localdb-isolated');

revoke all on schema taxiflow_local from public, anon, authenticated;
revoke all on table taxiflow_local.instance from public, anon, authenticated;
