-- Based on Supabase's official self-hosted volumes/db/roles.sql: service roles take
-- the local POSTGRES_PASSWORD from the container environment. The pinned image
-- (17.11.0.004) does not have every role the upstream file names (e.g.
-- supabase_functions_admin), so only roles that exist are altered.
-- Runs once, on first initialisation of the local volume.
\set pgpass `echo "$POSTGRES_PASSWORD"`

select format('alter role %I with password %L', rolname, :'pgpass')
from pg_roles
where rolname in ('authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_functions_admin')
\gexec
