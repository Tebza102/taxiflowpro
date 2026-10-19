#!/usr/bin/env node
// Release file 06 (member permissions) against the LOCAL TEST stack only:
//   TAXIFLOW_LOCALDB_PROFILE=test node scripts/localdb/member-permissions-migration-tests.mjs
// Requires a fresh `TAXIFLOW_LOCALDB_PROFILE=test node scripts/localdb/setup.mjs reset`.
// Proves: effective permissions preserved by the backfill; role change resets;
// only an active Owner can change Admin/Manager permissions (never their own,
// never an Owner's or a Driver's); unknown values refused; a stale version
// writes nothing; the rollback removes everything and re-applying restores the
// defaults; nothing else in memberships or snapshots changes.
import { readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { ACTIVE_PROFILE } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID } from "./seed-data.mjs";

if (ACTIVE_PROFILE.name !== "test") {
  console.error("Run with TAXIFLOW_LOCALDB_PROFILE=test: this suite applies and rolls back release file 06.");
  process.exit(2);
}
assertLoopbackOnlyOrStop();
assertLocalDatabase();

const MIGRATION = path.join(REPO_ROOT, "scripts", "localdb", "migrations", "20261019090000_member_permissions.sql");
const ROLLBACK = path.join(REPO_ROOT, "scripts", "localdb", "rollback", "20261019090000_member_permissions.down.sql");
const results = [];
const record = (ok, label, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
};
const q = (sql) => psql(sql).stdout.trim();
const tryRun = (sql) => {
  const result = psql(sql, { allowFailure: true });
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
};
const hasColumn = () => q("select count(*) from information_schema.columns where table_schema='public' and table_name='business_memberships' and column_name='permissions';") === "1";
const membershipsShape = () => q("select md5(string_agg(business_id::text||user_id::text||role||active::text||coalesce(driver_staff_id,''), ',' order by business_id, user_id)) from public.business_memberships;");
const snapshotsHash = () => q("select md5(string_agg(md5(snapshot::text)||updated_at::text, ',' order by business_id)) from public.workspace_snapshots;");
const userOf = (role, businessId = BUSINESS_A_ID) => q(`select user_id from public.business_memberships where business_id='${businessId}' and role='${role}' and active order by user_id limit 1;`);
const permsOf = (userId, businessId = BUSINESS_A_ID) => q(`select array_to_string(permissions, ',') from public.business_memberships where business_id='${businessId}' and user_id='${userId}';`);
const versionOf = (businessId = BUSINESS_A_ID) => q(`select updated_at from public.workspace_snapshots where business_id='${businessId}';`);
const setPerms = (actor, target, perms, { version = null, snapshot = null, businessId = BUSINESS_A_ID } = {}) =>
  tryRun(`select public.set_member_permissions('${businessId}', '${actor}', '${target}', array[${perms.map((p) => `'${p}'`).join(",")}]::text[], ${version ? `'${version}'` : "null"}, ${snapshot ? `'${snapshot}'::jsonb` : "null"});`);
const apply = (file) => {
  const result = psql(`begin;\n${readFileSync(file, "utf8")}\ncommit;\n`, { allowFailure: true });
  if (result.status !== 0) throw new Error(`${path.basename(file)} failed: ${result.stderr.slice(-400)}`);
};

// The reset already applied file 06 (it is in the migration list). Start from the
// pre-06 state to prove the upgrade path: roll back, capture, re-apply.
apply(ROLLBACK);
record(!hasColumn(), "rollback removes the permissions column");

// The release-06 server code on a database WITHOUT file 06 (deploy-before-migrate,
// or after the file is rolled back): memberships still read, role defaults apply.
{
  const { createClient } = await import("@supabase/supabase-js");
  const { readOwnMemberships } = await import("../../api/_lib/tenantAuth.js");
  const { effectivePermissions } = await import("../../src/lib/memberPermissions.js");
  const status = assertLocalDatabase();
  const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminId = q(`select user_id from public.business_memberships where business_id='${BUSINESS_A_ID}' and role='Admin' and active limit 1;`);
  const { data, error } = await readOwnMemberships(service, adminId);
  const row = (data ?? []).find((m) => m.business_id === BUSINESS_A_ID);
  const effective = effectivePermissions({ role: row?.role, permissions: Array.isArray(row?.permissions) ? row.permissions : null, moduleAccess: { finance: true } });
  record(!error && row && row.permissions === undefined && effective.join(",") === "cash.count", "without file 06 the server reads memberships and applies the pre-06 role rules", error?.code ?? effective.join(","));
}
const shapeBefore = membershipsShape();
const snapshotsBefore = snapshotsHash();
apply(MIGRATION);
record(hasColumn(), "migration adds the permissions column");
record(membershipsShape() === shapeBefore, "roles, activity and driver links unchanged by the migration");
record(snapshotsHash() === snapshotsBefore, "snapshots unchanged by the migration");

const counts = q(`select string_agg(role||':'||array_to_string(permissions, '+'), ' ' order by role) from (select distinct role, permissions from public.business_memberships) s;`);
record(
  counts.split(" ").sort().join(" ") === ["Admin:cash.count", "Driver:", "Manager:cash.verify+cash.bank", "Owner:"].sort().join(" "),
  "backfill preserves effective permissions per role",
  counts,
);

apply(MIGRATION);
record(membershipsShape() === shapeBefore && snapshotsHash() === snapshotsBefore, "re-applying file 06 is idempotent");

const owner = userOf("Owner");
const admin = userOf("Admin");
const manager = userOf("Manager");
const driver = userOf("Driver");

// Only an active Owner; never self; never Owner or Driver targets.
const byAdmin = setPerms(admin, manager, ["cash.count"]);
record(!byAdmin.ok && /Only the Owner, or someone given/.test(byAdmin.out), "an Admin cannot change permissions");
const byManager = setPerms(manager, manager, ["cash.count", "cash.verify", "cash.bank", "fleet.manage", "drivers.manage"]);
record(!byManager.ok && /Only the Owner, or someone given/.test(byManager.out), "a Manager cannot raise their own permissions");
record(/42501|Only the Owner, or someone given/.test(setPerms(driver, admin, ["cash.bank"]).out), "a Driver cannot change permissions");
record(/own responsibilities/.test(setPerms(owner, owner, ["cash.count"]).out), "the Owner cannot change their own entry");
record(/Only Admin and Manager/.test(setPerms(owner, driver, ["cash.count"]).out), "a Driver cannot be given staff permissions");
record(!tryRun(`update public.business_memberships set permissions = array['cash.bank'] where user_id='${driver}' and business_id='${BUSINESS_A_ID}';`).ok, "the table refuses permissions on a Driver row");
record(/Unknown responsibility/.test(setPerms(owner, admin, ["cash.count", "platform.admin"]).out), "unknown permission values are refused");

// Owner sets an Admin to count-only and a Manager to fleet + drivers, without banking.
record(setPerms(owner, admin, ["cash.count"]).ok && permsOf(admin) === "cash.count", "Owner keeps an Admin to counting only");
const managerSet = setPerms(owner, manager, ["fleet.manage", "drivers.manage", "drivers.manage"]);
record(managerSet.ok && permsOf(manager) === "drivers.manage,fleet.manage", "Owner grants a Manager drivers and fleet (deduplicated), banking removed");

// A stale snapshot version writes nothing; the current one applies atomically.
const version = versionOf();
const stale = setPerms(owner, manager, ["cash.bank"], { version: "2000-01-01T00:00:00Z", snapshot: "{\"marker\":1}" });
record(stale.ok && /conflict/.test(stale.out) && permsOf(manager) === "drivers.manage,fleet.manage" && versionOf() === version, "a stale version changes neither permissions nor snapshot");

// Cross-business: an Owner of A cannot change a member of another business.
const otherBusiness = q(`select business_id from public.business_memberships where business_id <> '${BUSINESS_A_ID}' and role in ('Admin','Manager') limit 1;`);
if (otherBusiness) {
  const otherMember = q(`select user_id from public.business_memberships where business_id='${otherBusiness}' and role in ('Admin','Manager') limit 1;`);
  const crossSameId = setPerms(owner, otherMember, ["cash.bank"], { businessId: otherBusiness });
  record(!crossSameId.ok && /Only the Owner, or someone given/.test(crossSameId.out), "an Owner of A cannot change permissions in another business");
}

// A role change resets permissions to the new role's defaults (no carried powers).
q(`update public.business_memberships set role='Admin' where business_id='${BUSINESS_A_ID}' and user_id='${manager}';`);
record(permsOf(manager) === "cash.count", "Manager -> Admin resets permissions to Admin defaults");
q(`update public.business_memberships set role='Manager' where business_id='${BUSINESS_A_ID}' and user_id='${manager}';`);
record(permsOf(manager) === "cash.bank,cash.verify" || permsOf(manager) === "cash.verify,cash.bank", "Admin -> Manager resets permissions to Manager defaults");

// Grants: the RPC is service-role only.
const grants = q("select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_schema='public' and routine_name='set_member_permissions';");
record(grants === "postgres,service_role" || grants === "service_role", "set_member_permissions is executable by the service role only", grants);

// Rollback, then re-apply: defaults come back, nothing else changes.
const shapeMid = membershipsShape();
apply(ROLLBACK);
record(!hasColumn() && q("select count(*) from pg_proc where proname='set_member_permissions';") === "0", "rollback removes column, trigger and functions");
record(membershipsShape() === shapeMid, "rollback keeps memberships unchanged");
record(q("select to_regclass('public.member_permission_changes') is not null;") === "t", "rollback keeps the audit of past responsibility changes");
apply(MIGRATION);
record(permsOf(admin) === "cash.count" && hasColumn(), "re-applying after rollback restores role defaults");

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
