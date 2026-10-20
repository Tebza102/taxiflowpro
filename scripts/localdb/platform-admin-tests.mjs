#!/usr/bin/env node
// Platform administration proof (release file 05) against the LOCAL synthetic
// stack with REAL local Auth tokens and the real handlers:
// * only an operator-granted platform admin can list and create companies;
//   business roles (Owner included), forged token metadata, the browser and
//   the service role cannot grant it;
// * the platform admin creates a second company and onboards its Owner (setup
//   email; no password chosen by anyone else); retries are safe; slug hijack,
//   self-ownership and forged fields are refused; an existing account becomes
//   Owner of the new company only, unchanged elsewhere;
// * the platform grant gives NO company data access;
// * the new Owner onboards Admin, Manager and Driver in their company only;
//   the Driver sees only their own records and a saved capture persists;
// * the existing business (Tenant 1, mapped from taxiflow-live) is unchanged;
// * revocation and the release-file rollback both fail closed.
// Requires a fresh `node scripts/localdb/setup.mjs reset`.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { activateViaEmail as activateViaEmailWith } from "./lib/mailpit.mjs";
import { LOCAL_MAIL_PORT } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { default: platformHandler } = await import("../../api/platform/businesses.js");
const { default: membersHandler } = await import("../../api/business/members.js");
const { default: workspaceHandler } = await import("../../api/business/workspace.js");
const { default: financeHandler } = await import("../../api/business/finance-actions.js");
const { default: membershipsHandler } = await import("../../api/business/memberships.js");
const { default: reportViewHandler } = await import("../../api/admin/daily-log/report-view.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
// Reads run inside the local database container only (psql); writes and every
// handler call that can write re-check the local target and bindings first.
const sql = (t) => psql(t).stdout.trim();
const sqlWrite = (t) => {
  guard();
  return sql(t);
};
const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anonClient = () => createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });

const fingerprint = (businessId) =>
  sql(`select md5(snapshot::text) || '@' || updated_at from public.workspace_snapshots where business_id = '${businessId}';`);
const membershipsOf = (businessId) =>
  sql(`select coalesce(string_agg(user_id || ':' || role || ':' || active || ':' || coalesce(driver_staff_id, '-'), ',' order by user_id), '') from public.business_memberships where business_id = '${businessId}';`);
const authUserId = (email) => sql(`select coalesce((select id::text from auth.users where lower(email) = lower('${email}')), 'none');`);
const passwordHash = (email) => sql(`select coalesce((select encrypted_password from auth.users where lower(email) = lower('${email}')), 'none');`);
const businessCount = () => Number(sql("select count(*) from public.businesses;"));
const version = (businessId) => sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${businessId}';`);
const mailCount = async (email) => {
  const search = await fetch(`http://127.0.0.1:${LOCAL_MAIL_PORT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
  return search.messages?.length ?? 0;
};

const callHandler = async (handler, { method = "GET", token, query = {}, body, headers = {} }) => {
  if (method !== "GET") guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, headers: { authorization: token ? `Bearer ${token}` : "", host: "127.0.0.1:5175", ...headers }, query, body }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* binary or empty */ }
  return { status: res.statusCode, json, raw: String(res.body ?? ""), headers: res.headers };
};
const platformGet = (token) => callHandler(platformHandler, { token });
const platformCreate = (token, fields, action = "company.create") => callHandler(platformHandler, { method: "POST", token, body: { action, fields } });
const workspace = (token, businessId) => callHandler(workspaceHandler, { token, query: businessId ? { business: businessId } : {} });
const members = (token, action, fields, businessId) => callHandler(membersHandler, { method: "POST", token, query: businessId ? { business: businessId } : {}, body: { action, fields } });

const signIn = async (email, password = LOCAL_TEST_PASSWORD) => {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { token: data.session.access_token, userId: data.user.id, client };
};
const activate = (email) => activateViaEmailWith({ apiUrl: status.apiUrl, anonKey: status.ANON_KEY, email, password: LOCAL_TEST_PASSWORD });
const grantPlatformAdmin = (email) =>
  sqlWrite(`insert into public.platform_admins (user_id, granted_by, note) select id, 'operator', 'local test' from auth.users where lower(email) = lower('${email}') on conflict (user_id) do update set active = true; select count(*) from public.platform_admins where active;`);

// --- 0. Baseline: the existing business (Tenant 1) and business B -----------------------
const baseline = { A: fingerprint(BUSINESS_A_ID), B: fingerprint(BUSINESS_B_ID), memA: membershipsOf(BUSINESS_A_ID), memB: membershipsOf(BUSINESS_B_ID), businesses: businessCount() };
record(baseline.businesses === 2 && baseline.A.length > 0, "baseline: Tenant 1 (taxiflow-live mapping) and business B exist", `businesses=${baseline.businesses}`);
record(sql("select count(*) from public.platform_admins;") === "0", "baseline: no platform admins until the operator grants one");

const ownerA = await signIn("owner@example.com");
const adminA = await signIn("admin@example.com"); // the account that becomes platform admin (mirrors an existing login)
const driverA = await signIn("driver@example.com");
const outsider = await signIn("outsider@example.com");
record(!ownerA.error && !adminA.error && !driverA.error && !outsider.error, "seed identities sign in");

// --- 1. Nobody is a platform admin by role, metadata or self-grant -----------------------
let r = await platformGet(null);
record(r.status === 401, "no token: platform list refused (401)", `${r.status}`);
r = await platformGet("garbage.token.value");
record(r.status === 401, "garbage token: refused (401)", `${r.status}`);
for (const [label, who] of [["Owner of Tenant 1", ownerA], ["Admin of Tenant 1 (before grant)", adminA], ["Driver", driverA], ["non-member", outsider]]) {
  r = await platformGet(who.token);
  const c = await platformCreate(who.token, { name: "Escalation Taxis", ownerEmail: "esc@example.com" });
  record(r.status === 403 && c.status === 403, `${label}: platform list and create refused (403)`, `${r.status}/${c.status}`);
}
record(businessCount() === baseline.businesses && authUserId("esc@example.com") === "none", "refused creates wrote nothing (no business, no account)");

// Forged metadata on the token does not make a platform admin.
await service.auth.admin.updateUserById(ownerA.userId, { user_metadata: { platform_admin: true, role: "platform_admin" }, app_metadata: { platform_admin: true, role: "platform_admin" } });
const ownerAForged = await signIn("owner@example.com");
r = await platformGet(ownerAForged.token);
record(r.status === 403, "forged user/app metadata (platform_admin) refused", `${r.status}`);
await service.auth.admin.updateUserById(ownerA.userId, { user_metadata: {}, app_metadata: { provider: "email", providers: ["email"] } });

// Browser and service role cannot read or write the grant table.
for (const [label, client] of [["anon", anonClient()], ["authenticated Owner", ownerA.client]]) {
  const read = await client.from("platform_admins").select("user_id");
  const write = await client.from("platform_admins").insert({ user_id: ownerA.userId });
  record(Boolean(read.error) && Boolean(write.error), `${label}: cannot read or insert platform_admins`, `${read.error?.code}/${write.error?.code}`);
}
const svcWrite = await service.from("platform_admins").insert({ user_id: ownerA.userId });
record(Boolean(svcWrite.error) && sql("select count(*) from public.platform_admins;") === "0", "service role cannot grant platform admin (select only)", svcWrite.error?.code);
record(sql("select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.platform_admins'::regclass;") === "t", "platform_admins has RLS enabled and forced");
record(
  sql("select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'platform_admins' and grantee in ('anon', 'authenticated', 'PUBLIC');") === "0",
  "no anon/authenticated/PUBLIC grants on platform_admins",
);

// --- 2. Operator grant -> the platform console works ---------------------------------------
record(grantPlatformAdmin("admin@example.com") === "1", "operator grants platform admin to an existing login (one row)");
r = await platformGet(adminA.token);
const tenant1 = r.json.companies?.find((c) => c.businessId === BUSINESS_A_ID);
record(r.status === 200 && tenant1?.tenantNumber === 1 && tenant1.owners.includes("owner@example.com"), "platform admin lists companies; the existing business is Tenant 1 with its Owner", `${r.status} ${JSON.stringify(tenant1 ?? r.json)}`);
record(!/financeTransactions|dailyCashUps|auditTrail|"snapshot"|deposits|vehicles/.test(r.raw), "company list is metadata only (no workspace data)");
record(r.headers["Cache-Control"] === "no-store", "platform responses are not cacheable");

// The platform grant gives no extra power inside Tenant 1 (still Admin there).
const adminWorkspace = await workspace(adminA.token, BUSINESS_A_ID);
record(adminWorkspace.status === 200 && adminWorkspace.json.role === "Admin", "platform admin keeps exactly their membership role in Tenant 1 (Admin)", adminWorkspace.json.role);
r = await members(adminA.token, "member.grant", { email: "x@example.com", role: "Manager" }, BUSINESS_A_ID);
record(r.status === 403, "platform admin (Admin in Tenant 1) still cannot grant access there", `${r.status}`);
r = await workspace(adminA.token, BUSINESS_B_ID);
record(r.status === 403, "platform admin cannot read another company's workspace (business B)", `${r.status}`);

// --- 3. Create a company and onboard its Owner --------------------------------------------
const C2 = { name: "Second Fleet Taxis", ownerEmail: "owner.second@example.com", ownerName: "Second Owner" };
const forged = [
  ["unknown field role", { ...C2, role: "Owner" }],
  ["unknown field businessId", { ...C2, businessId: BUSINESS_A_ID }],
  ["unknown field ownerUserId", { ...C2, ownerUserId: ownerA.userId }],
  ["invalid email", { ...C2, ownerEmail: "not-an-email" }],
  ["missing name", { ...C2, name: "" }],
  ["bad slug", { ...C2, slug: "A!" }],
  ["non-boolean ownerDrives", { ...C2, ownerDrives: "yes" }],
];
for (const [label, fields] of forged) {
  r = await platformCreate(adminA.token, fields);
  record(r.status === 400 && businessCount() === baseline.businesses && authUserId("owner.second@example.com") === "none", `create refused: ${label} (nothing written)`, `${r.status} ${r.json.error ?? ""}`);
}
r = await platformCreate(adminA.token, C2, "company.delete");
record(r.status === 400, "unsupported platform action refused", `${r.status}`);
r = await platformCreate(adminA.token, { ...C2, ownerEmail: "admin@example.com" });
record(r.status === 403 && businessCount() === baseline.businesses, "platform admin cannot make themselves Owner of a new company", `${r.status}`);

r = await platformCreate(adminA.token, C2);
const C2_ID = r.json.businessId;
record(r.status === 200 && r.json.status === "created" && r.json.slug === "second-fleet-taxis" && r.json.ownerAccount === "new" && r.json.setupEmailSent === true, "platform admin creates company 2 with a NEW Owner (setup email sent)", JSON.stringify(r.json));
record(membershipsOf(C2_ID).split(",").length === 1 && membershipsOf(C2_ID).includes(":Owner:true:"), "company 2 has exactly one active member: its Owner");
record(Boolean((await signIn("owner.second@example.com")).error), "the new Owner cannot sign in until they set their own password (none was chosen for them)");
const auditC2 = JSON.parse(sql(`select (snapshot->'auditTrail')::text from public.workspace_snapshots where business_id = '${C2_ID}';`));
record(auditC2.length === 1 && auditC2[0].title === "Company created" && auditC2[0].actorId === adminA.userId, "company 2's audit trail records the platform admin who created it");

const mailsBefore = await mailCount("owner.second@example.com");
r = await platformCreate(adminA.token, C2);
record(r.status === 200 && r.json.status === "existing" && r.json.businessId === C2_ID && businessCount() === baseline.businesses + 1, "repeating the same create is a safe no-op", JSON.stringify({ status: r.json.status }));
record((await mailCount("owner.second@example.com")) === mailsBefore, "the retry sent no second email and reset nothing");
r = await platformCreate(adminA.token, { ...C2, ownerEmail: "hijack@example.com" });
record(r.status === 409 && membershipsOf(C2_ID).split(",").length === 1, "another Owner for an existing slug is refused (slug hijack)", `${r.status}`);

// Existing account as the Owner of company 3: reused unchanged, no reset, Tenant 1 access untouched.
const driverHashBefore = passwordHash("driver@example.com");
const memABefore = membershipsOf(BUSINESS_A_ID);
r = await platformCreate(adminA.token, { name: "Third Fleet Taxis", slug: "third-fleet", ownerEmail: "driver@example.com", ownerName: "UAT Driver" });
const C3_ID = r.json.businessId;
record(r.status === 200 && r.json.ownerAccount === "existing" && r.json.setupEmailSent === false, "existing account becomes Owner of company 3 (no setup email)", JSON.stringify(r.json));
record(passwordHash("driver@example.com") === driverHashBefore && !(await signIn("driver@example.com")).error, "existing account: password unchanged and still signs in (no reset)");
record(membershipsOf(BUSINESS_A_ID) === memABefore, "existing account: Tenant 1 memberships unchanged (still Driver there)");

// The platform admin has no data access to the companies it created.
for (const [label, id] of [["company 2", C2_ID], ["company 3", C3_ID]]) {
  const w = await workspace(adminA.token, id);
  const m = await callHandler(membersHandler, { token: adminA.token, query: { business: id } });
  record(w.status === 403 && m.status === 403, `platform admin cannot read ${label}'s workspace or members`, `${w.status}/${m.status}`);
}

// --- 4. The new Owner sets a password from the email and onboards staff --------------------
const activated = await activate("owner.second@example.com");
record(activated.ok === true, "company 2 Owner sets their own password from the setup email", activated.error);
const owner2 = await signIn("owner.second@example.com");
r = await callHandler(membershipsHandler, { token: owner2.token });
record(r.status === 200 && r.json.businesses?.length === 1 && r.json.businesses[0].businessId === C2_ID && r.json.businesses[0].role === "Owner", "company 2 Owner sees only company 2", JSON.stringify(r.json.businesses));
r = await workspace(owner2.token);
record(r.status === 200 && r.json.businessId === C2_ID && (r.json.snapshot.financeTransactions ?? []).length === 0 && (r.json.snapshot.vehicles ?? []).length === 0, "company 2 workspace opens empty (no Tenant 1 data)");
for (const id of [BUSINESS_A_ID, BUSINESS_B_ID, C3_ID]) {
  r = await workspace(owner2.token, id);
  record(r.status === 403, `company 2 Owner cannot read ${id === BUSINESS_A_ID ? "Tenant 1" : id === BUSINESS_B_ID ? "business B" : "company 3"}`, `${r.status}`);
}
r = await platformGet(owner2.token);
record(r.status === 403, "company 2 Owner has no platform access", `${r.status}`);

r = await members(owner2.token, "member.grant", { email: "admin.second@example.com", name: "Second Admin", role: "Admin" });
record(r.status === 200 && r.json.accountCreated === true, "company 2 Owner grants Admin (new account, setup email)", `${r.status}`);
r = await members(owner2.token, "member.grant", { email: "manager.second@example.com", name: "Second Manager", role: "Manager" });
record(r.status === 200 && r.json.role === "Manager", "company 2 Owner grants Manager", `${r.status}`);
r = await members(owner2.token, "driver.save_profile", { name: "Second Driver" });
const driverStaffId = r.json.staffId;
record(r.status === 200 && Boolean(driverStaffId), "company 2 Owner adds a driver profile", `${r.status}`);
r = await members(owner2.token, "member.grant", { email: "driver.second@example.com", name: "Second Driver", role: "Driver", driverStaffId });
record(r.status === 200 && r.json.role === "Driver", "company 2 Owner grants Driver linked to that profile", `${r.status}`);
r = await members(owner2.token, "member.grant", { email: "owner2b@example.com", role: "Owner" });
record(r.status === 403 && authUserId("owner2b@example.com") === "none", "company 2 Owner cannot mint another Owner", `${r.status}`);
r = await members(owner2.token, "member.grant", { email: "manager@example.com", role: "Manager" }, BUSINESS_A_ID);
record(r.status === 403, "company 2 Owner cannot grant access in Tenant 1", `${r.status}`);
record(membershipsOf(BUSINESS_A_ID) === baseline.memA, "Tenant 1 memberships still exactly the baseline");

// --- 5. Driver privacy and a persistent save in company 2 ----------------------------------
record((await activate("driver.second@example.com")).ok === true, "company 2 Driver sets their own password");
record((await activate("manager.second@example.com")).ok === true, "company 2 Manager sets their own password");
const driver2 = await signIn("driver.second@example.com");
const manager2 = await signIn("manager.second@example.com");
r = await callHandler(financeHandler, {
  method: "POST", token: driver2.token, query: { business: C2_ID },
  body: { action: "capture.expense", requestId: randomUUID(), expectedVersion: version(C2_ID), fields: { expenseKind: "operational", category: "Fuel", description: "Second fleet fuel", expenseDate: "2026-10-17", amount: 150, cashExpense: true } },
});
record(r.status === 200, "company 2 Driver captures an expense", `${r.status} ${r.json.error ?? ""}`);
const driverView = await workspace(driver2.token);
const ownRecords = driverView.json.snapshot?.financeTransactions ?? [];
record(driverView.status === 200 && driverView.json.scope !== "full" && ownRecords.some((t) => t.description === "Second fleet fuel"), "the Driver's saved expense persists on a fresh read (driver-scoped payload)", `scope=${driverView.json.scope}`);
record(!JSON.stringify(driverView.json.snapshot).includes("owner.second@example.com") || (driverView.json.snapshot.appUsers ?? []).length <= 1, "Driver payload does not expose the company directory");
r = await callHandler(membersHandler, { token: driver2.token });
record(r.status === 403, "company 2 Driver cannot list members", `${r.status}`);
r = await workspace(manager2.token);
record(r.status === 200 && r.json.role === "Manager" && (r.json.snapshot.financeTransactions ?? []).some((t) => t.description === "Second fleet fuel"), "company 2 Manager sees the Driver's saved expense");
r = await callHandler(reportViewHandler, { token: manager2.token, query: { id: "2026-10-17", business: BUSINESS_A_ID } });
record(r.status === 403, "company 2 Manager cannot open a Tenant 1 report", `${r.status}`);

// --- 6. Existing business regression -------------------------------------------------------
record(fingerprint(BUSINESS_A_ID) === baseline.A, "Tenant 1 snapshot unchanged (hash and version)");
record(fingerprint(BUSINESS_B_ID) === baseline.B && membershipsOf(BUSINESS_B_ID) === baseline.memB, "business B snapshot and memberships unchanged");
r = await workspace(ownerA.token);
record(r.status === 200 && r.json.businessId === BUSINESS_A_ID && r.json.role === "Owner", "Tenant 1 Owner still opens Tenant 1 as Owner");
r = await callHandler(membershipsHandler, { token: ownerA.token });
record(r.status === 200 && r.json.businesses.length === 1, "Tenant 1 Owner does not see the new companies", JSON.stringify(r.json.businesses?.map((b) => b.name)));

// --- 7. Revocation and rollback fail closed ------------------------------------------------
sqlWrite("update public.platform_admins set active = false;");
r = await platformGet(adminA.token);
record(r.status === 403, "revoked platform admin is refused with the same token", `${r.status}`);
sqlWrite(`begin;\n${readFileSync(path.join(HERE, "rollback", "20261018090000_platform_admins.down.sql"), "utf8")}\ncommit;`);
r = await platformGet(adminA.token);
record(r.status === 403, "after the release-file rollback the platform API refuses (fail closed)", `${r.status}`);
record(businessCount() === baseline.businesses + 2 && membershipsOf(C2_ID).split(",").length === 4, "rollback keeps the companies and memberships created through the console");
sqlWrite(`begin;\n${readFileSync(path.join(HERE, "migrations", "20261018090000_platform_admins.sql"), "utf8")}\ncommit;`);
sqlWrite(`begin;\n${readFileSync(path.join(HERE, "migrations", "20261018090000_platform_admins.sql"), "utf8")}\ncommit;`);
record(sql("select count(*) from public.platform_admins;") === "0", "re-applying file 05 (twice, idempotent) starts with no grants");
grantPlatformAdmin("admin@example.com");
r = await platformGet(adminA.token);
record(r.status === 200 && r.json.companies.length === 4, "after the re-grant the console lists all 4 companies", `${r.status}`);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
