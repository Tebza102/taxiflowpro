#!/usr/bin/env node
// RETIRED (2026-10-10). This script deleted Supabase Auth users and rewrote the
// legacy taxiflow-live appUsers list with a service-role key. Access now comes
// only from business memberships, so it could break every business's access.
// It stops here, before reading any setting or opening any connection. The
// previous implementation is in Git history only.
console.error(`RETIRED: scripts/reset-production-users.mjs is disabled and does nothing.
It targeted the legacy taxiflow-live appUsers list, which no longer controls access.
Use instead:
  - people and roles: Business access in the app (Owner), or POST /api/business/members
  - a new business and its first Owner: scripts/hosted/onboard-business.mjs
  - the first Owner of an existing business: scripts/hosted/assign-initial-owner.mjs
  - backup and restore: scripts/backup/backup.mjs
See project-os/05-build/pilot-release-checklist.md.`);
process.exit(2);
