alter table if exists shift_reconciliations
  add column if not exists time_in time,
  add column if not exists time_out time,
  add column if not exists odometer_start integer,
  add column if not exists odometer_end integer,
  add column if not exists km_computed numeric(12, 2),
  add column if not exists trip_duration_min integer,
  add column if not exists day_start_odometer integer,
  add column if not exists day_end_odometer integer,
  add column if not exists notes text;
