#!/usr/bin/env node
// RETIRED (2026-10-10). This script repaired the legacy taxiflow-live appUsers
// list from Supabase Auth with a service-role key. Access now comes only from
// business memberships, and appUsers is no longer the access source. It stops
// here, before reading any setting or opening any connection. The previous
// implementation is in Git history only.
console.error(`RETIRED: scripts/reconcile-production-users.mjs is disabled and does nothing.
It repaired the legacy taxiflow-live appUsers list, which no longer controls access.
Use instead:
  - people and roles: Business access in the app (Owner), or POST /api/business/members
  - a new business and its first Owner: scripts/hosted/onboard-business.mjs
  - the first Owner of an existing business: scripts/hosted/assign-initial-owner.mjs
See project-os/05-build/pilot-release-checklist.md.`);
process.exit(2);
