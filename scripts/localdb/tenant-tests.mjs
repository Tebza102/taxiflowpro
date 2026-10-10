#!/usr/bin/env node
// Tenant foundation tests against the LOCAL synthetic database, as real
// non-privileged identities through the local API (Kong -> PostgREST/GoTrue).
//   node scripts/localdb/tenant-tests.mjs access     negative + positive access checks
//   node scripts/localdb/tenant-tests.mjs rollback   compatibility, rollback and re-apply
// Requires a fresh `node scripts/localdb/setup.mjs reset`. The local target and
// loopback-only bindings are re-verified before every mutation attempt.
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, localStatus, psql } from "./lib/exec.mjs";
import { snapshotManifest, stableStringify } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, BUSINESS_B_WORKSPACE_KEY, LOCAL_TEST_PASSWORD, TENANT_USERS } from "./seed-data.mjs";
import { applyMigrationFile, applyRollbackFile } from "./setup.mjs";

const TENANT_MIGRATION = "20261010003451_tenant_foundation.sql";
const TENANT_ROLLBACK = "20261010003451_tenant_foundation.down.sql";
const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (text) => psql(text).stdout.trim();

const status = localStatus();
const userId = (email) => [...TENANT_USERS, { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com" }, { id: "00000000-0000-4000-8000-000000000004", email: "driver@example.com" }, { id: "00000000-0000-4000-8000-000000000003", email: "manager@example.com" }].find((u) => u.email === email)?.id;

const clientFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  if (email) {
    const { error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  }
  return client;
};

const membersPost = async (client, body) => {
  guard();
  process.env.SUPABASE_URL = status.apiUrl;
  process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
  const { default: handler } = await import("../../api/business/members.js");
  const { data } = await client.auth.getSession();
  const out = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${data.session.access_token}`, host: "127.0.0.1:5175" }, query: {}, body }, out);
  let json = {};
  try { json = JSON.parse(out.body); } catch { /* */ }
  return { status: out.statusCode, json };
};

const denied = (response) => Boolean(response.error) && (response.error.code === "42501" || /permission denied|not allowed|Only an active Owner|cannot|Sign in/i.test(response.error.message));
const describe = (response) =>
  response.error ? `${response.error.code ?? ""} ${response.error.message}`.trim() : `${Array.isArray(response.data) ? response.data.length : response.data ? 1 : 0} row(s)`;

const snapshotHashes = () => {
  const rows = JSON.parse(sql("select coalesce(json_object_agg(workspace_key, snapshot order by workspace_key), '{}') from public.workspace_snapshots;"));
  return Object.fromEntries(Object.entries(rows).map(([key, snapshot]) => [key, snapshotManifest(snapshot).sha256]));
};
// Same, ignoring the business directory and audit trail (what an access change
// legitimately touches).
const snapshotHashesExceptAccess = () => {
  const rows = JSON.parse(sql("select coalesce(json_object_agg(workspace_key, snapshot - 'appUsers' - 'auditTrail' order by workspace_key), '{}') from public.workspace_snapshots;"));
  return Object.fromEntries(Object.entries(rows).map(([key, snapshot]) => [key, snapshotManifest(snapshot).sha256]));
};
const membershipHash = () => sql("select coalesce(json_agg(json_build_array(business_id, user_id, role, driver_staff_id, active) order by business_id, user_id), '[]') from public.business_memberships;");

const access = async () => {
  let before = snapshotHashes();
  const beforeExceptAccess = snapshotHashesExceptAccess();
  const anon = await clientFor(null);
  const outsider = await clientFor("outsider@example.com");
  const ownerA = await clientFor("owner@example.com");
  const driverA = await clientFor("driver@example.com");
  const managerA = await clientFor("manager@example.com");
  const inactiveA = await clientFor("inactive.a@example.com");
  const ownerB = await clientFor("owner.b@example.com");
  const newhire = await clientFor("newhire.a@example.com");
  const newhireId = userId("newhire.a@example.com");

  // Anonymous / non-member
  record(denied(await anon.from("workspace_snapshots").select("workspace_key")), "anon cannot read snapshots");
  record(denied(await anon.from("businesses").select("id")), "anon cannot read businesses");
  guard();
  record(denied(await anon.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: newhireId, p_role: "Manager" })), "anon cannot administer memberships");
  record(denied(await outsider.from("workspace_snapshots").select("workspace_key")), "non-member cannot read snapshots");
  const outsiderBiz = await outsider.from("businesses").select("id");
  record(!outsiderBiz.error && outsiderBiz.data.length === 0, "non-member sees no businesses", describe(outsiderBiz));
  const outsiderMem = await outsider.from("business_memberships").select("business_id");
  record(!outsiderMem.error && outsiderMem.data.length === 0, "non-member sees no memberships", describe(outsiderMem));

  // Direct browser snapshot access is denied even to an Owner
  const ownerRead = await ownerA.from("workspace_snapshots").select("workspace_key");
  record(denied(ownerRead), "Owner A cannot read any snapshot directly from the browser", describe(ownerRead));
  guard();
  record(denied(await ownerA.from("workspace_snapshots").update({ snapshot: {} }).eq("workspace_key", BUSINESS_B_WORKSPACE_KEY)), "Owner A cannot overwrite Business B's snapshot");
  guard();
  record(denied(await ownerA.from("workspace_snapshots").update({ snapshot: {} }).eq("workspace_key", "taxiflow-live")), "Owner A cannot overwrite its own snapshot from the browser");
  guard();
  record(denied(await ownerA.from("workspace_snapshots").insert({ workspace_key: "intruder", snapshot: {}, business_id: BUSINESS_B_ID })), "Owner A cannot insert a snapshot for Business B");
  guard();
  record(denied(await ownerA.from("workspace_snapshots").delete().eq("workspace_key", BUSINESS_B_WORKSPACE_KEY)), "Owner A cannot delete Business B's snapshot");

  // Cross-tenant visibility and administration
  const ownerABiz = await ownerA.from("businesses").select("id, slug");
  record(!ownerABiz.error && ownerABiz.data.length === 1 && ownerABiz.data[0].id === BUSINESS_A_ID, "Owner A sees only Business A", describe(ownerABiz));
  const ownerAMem = await ownerA.from("business_memberships").select("business_id");
  record(!ownerAMem.error && ownerAMem.data.length > 0 && ownerAMem.data.every((m) => m.business_id === BUSINESS_A_ID), "Owner A sees only Business A memberships", describe(ownerAMem));
  guard();
  const crossAdmin = await ownerA.rpc("set_business_membership", { p_business_id: BUSINESS_B_ID, p_user_id: newhireId, p_role: "Manager" });
  record(denied(crossAdmin), "Owner A cannot administer Business B", describe(crossAdmin));
  guard();
  record(denied(await ownerA.from("business_memberships").insert({ business_id: BUSINESS_B_ID, user_id: newhireId, role: "Manager" })), "Owner A cannot insert memberships directly");
  const ownerBBiz = await ownerB.from("businesses").select("id");
  record(!ownerBBiz.error && ownerBBiz.data.length === 1 && ownerBBiz.data[0].id === BUSINESS_B_ID, "Owner B sees only Business B", describe(ownerBBiz));

  // Escalation and self-assignment
  guard();
  const mintOwner = await ownerA.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: newhireId, p_role: "Owner" });
  record(denied(mintOwner), "Owner A cannot mint another Owner (escalation)", describe(mintOwner));
  guard();
  const selfChange = await ownerA.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: userId("owner@example.com"), p_role: "Admin" });
  record(denied(selfChange), "Owner A cannot change its own membership", describe(selfChange));

  // Driver
  record(denied(await driverA.from("workspace_snapshots").select("workspace_key, snapshot")), "Driver cannot read full snapshots");
  guard();
  const driverSelf = await driverA.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: userId("driver@example.com"), p_role: "Manager" });
  record(denied(driverSelf), "Driver cannot elevate its own membership via RPC", describe(driverSelf));
  guard();
  const driverUpdate = await driverA.from("business_memberships").update({ role: "Owner" }).eq("user_id", userId("driver@example.com"));
  record(denied(driverUpdate), "Driver cannot update its membership row directly", describe(driverUpdate));
  const driverMem = await driverA.from("business_memberships").select("user_id, role");
  record(!driverMem.error && driverMem.data.length === 1 && driverMem.data[0].role === "Driver", "Driver sees only its own membership", describe(driverMem));
  guard();
  const managerAdmin = await managerA.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: newhireId, p_role: "Driver", p_driver_staff_id: "x" });
  record(denied(managerAdmin), "Manager (non-Owner) cannot administer memberships", describe(managerAdmin));

  // Inactive membership grants nothing
  const inactiveBiz = await inactiveA.from("businesses").select("id");
  record(!inactiveBiz.error && inactiveBiz.data.length === 0, "inactive member sees no business", describe(inactiveBiz));

  // Tenant reassignment (every role, including service role and postgres)
  guard();
  const reassignSnapshot = psql(`update public.workspace_snapshots set business_id = '${BUSINESS_B_ID}' where workspace_key = 'taxiflow-live';`, { allowFailure: true });
  record(reassignSnapshot.status !== 0 && /cannot be moved/.test(reassignSnapshot.stderr), "snapshot tenant reassignment refused (postgres)", reassignSnapshot.stderr.trim().split(/\r?\n/)[0]);
  guard();
  const reassignMember = psql(`update public.business_memberships set business_id = '${BUSINESS_B_ID}' where user_id = '${userId("owner@example.com")}';`, { allowFailure: true });
  record(reassignMember.status !== 0 && /cannot be moved/.test(reassignMember.stderr), "membership tenant reassignment refused (postgres)", reassignMember.stderr.trim().split(/\r?\n/)[0]);
  const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  guard();
  const serviceReassign = await service.from("workspace_snapshots").update({ business_id: BUSINESS_B_ID }).eq("workspace_key", "taxiflow-live");
  record(Boolean(serviceReassign.error) && /cannot be moved/.test(serviceReassign.error.message), "snapshot tenant reassignment refused (service role)", describe(serviceReassign));

  // Positive controls (denials above are not vacuous)
  // Memberships change only through the Owner's server route (Task 18); the
  // browser RPC used here before is withdrawn.
  const add = await membersPost(ownerA, { action: "member.grant", fields: { email: "newhire.a@example.com", role: "Manager" } });
  record(add.status === 200 && add.json.role === "Manager", "Owner A can add a Manager to Business A (server route)", `${add.status} ${add.json.error ?? ""}`);
  const newhireBiz = await newhire.from("businesses").select("id");
  record(!newhireBiz.error && newhireBiz.data.length === 1 && newhireBiz.data[0].id === BUSINESS_A_ID, "new member now sees Business A only", describe(newhireBiz));
  const deactivate = await membersPost(ownerA, { action: "member.deactivate", fields: { userId: newhireId } });
  record(deactivate.status === 200 && deactivate.json.active === false, "Owner A can deactivate that membership (server route)", `${deactivate.status} ${deactivate.json.error ?? ""}`);
  // Those two server writes legitimately updated only Business A's directory and
  // audit trail; everything else, including every earlier browser attempt, is
  // unchanged. The final no-change check covers the attempts that follow.
  const afterAccess = snapshotHashes();
  record(
    stableStringify(snapshotHashesExceptAccess()) === stableStringify(beforeExceptAccess) &&
      Object.keys(afterAccess).every((key) => key === "taxiflow-live" || afterAccess[key] === before[key]),
    "only Business A's directory changed so far (no browser attempt wrote anything)",
  );
  before = afterAccess;
  const newhireAfter = await newhire.from("businesses").select("id");
  record(!newhireAfter.error && newhireAfter.data.length === 0, "deactivated member loses access", describe(newhireAfter));
  const serverRead = await service.from("workspace_snapshots").select("workspace_key, business_id");
  record(!serverRead.error && serverRead.data.length === 2, "server (service role) can read the per-business snapshots", describe(serverRead));
  // Regression for the trigger defect found in Task 12: a legitimate
  // same-business snapshot update must pass the reassignment trigger.
  guard();
  const legit = await service.from("workspace_snapshots").update({ updated_at: new Date().toISOString() }).eq("business_id", BUSINESS_A_ID).select("workspace_key");
  record(!legit.error && legit.data?.length === 1, "server can update its own business snapshot (same business passes the trigger)", describe(legit));
  guard();
  const legitMember = psql(`update public.business_memberships set updated_at = now() where user_id = '${userId("owner@example.com")}';`, { allowFailure: true });
  record(legitMember.status === 0, "a legitimate membership update passes the trigger", legitMember.stderr.trim().split(/\r?\n/)[0]);

  const after = snapshotHashes();
  record(stableStringify(before) === stableStringify(after), "no snapshot changed during the access tests", Object.keys(after).join(", "));
};

const rollback = async () => {
  const beforeSnapshots = snapshotHashes();
  const beforeMembers = membershipHash();
  const ownerA = await clientFor("owner@example.com");

  applyRollbackFile(TENANT_ROLLBACK);
  const rolledPolicies = sql("select count(*) from pg_policies where schemaname='public' and tablename='workspace_snapshots';");
  const legacyRead = await ownerA.from("workspace_snapshots").select("workspace_key");
  record(rolledPolicies === "3" && !legacyRead.error && legacyRead.data.length === 2, "rollback restores pre-tenant (live-mirror) access for the unchanged app", `${rolledPolicies} policies; owner read ${describe(legacyRead)}`);
  record(stableStringify(snapshotHashes()) === stableStringify(beforeSnapshots), "rollback preserves snapshot data");
  record(membershipHash() === beforeMembers, "rollback preserves memberships and business mapping (dormant)");

  // Compatibility: an unmapped workspace row must stop the migration (no fallback).
  guard();
  psql("insert into public.workspace_snapshots (workspace_key, snapshot) values ('unmapped-test', '{}'::jsonb);");
  let failedClosed = false;
  try {
    applyMigrationFile(TENANT_MIGRATION);
  } catch (error) {
    failedClosed = /Unmapped workspace_snapshots rows/.test(error.message);
  }
  record(failedClosed, "migration refuses unmapped workspace rows (no shared fallback)");
  guard();
  psql("delete from public.workspace_snapshots where workspace_key = 'unmapped-test';");

  applyMigrationFile(TENANT_MIGRATION);
  const reapplied = await ownerA.from("workspace_snapshots").select("workspace_key");
  record(denied(reapplied), "re-applied migration denies direct browser access again", describe(reapplied));
  record(stableStringify(snapshotHashes()) === stableStringify(beforeSnapshots), "re-apply preserves snapshot data");
  record(membershipHash() === beforeMembers, "re-apply preserves memberships (idempotent)");
  const grants = sql("select coalesce(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type), '') from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');");
  record(grants === "business_memberships:authenticated:SELECT,businesses:authenticated:SELECT", "hardened grants restored exactly", grants);
};

const mode = process.argv[2];
if (mode === "access") await access();
else if (mode === "rollback") await rollback();
else {
  console.error("Usage: node scripts/localdb/tenant-tests.mjs access|rollback");
  process.exit(2);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
