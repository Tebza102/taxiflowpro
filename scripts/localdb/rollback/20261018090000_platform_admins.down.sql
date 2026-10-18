-- Rollback of 20261018090000_platform_admins.sql (release file 05).
-- Safe for production: it only removes the platform-admin grant table. Companies,
-- Owners, memberships and snapshots created through the console are kept (they
-- are ordinary businesses and memberships). With the table gone the platform
-- API refuses everyone (fail closed).
drop table if exists public.platform_admins;
