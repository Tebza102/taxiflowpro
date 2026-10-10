#!/usr/bin/env node
// Pilot onboarding proof (Task 18) against the LOCAL synthetic stack with REAL
// local Auth: operator creates three businesses and their Owners, Owners grant
// Admin/Manager/Driver access, owner-driver linkage, driver profiles without
// sign-in, existing accounts, retries and partial failures, self-escalation,
// cross-business changes, last-Owner protection, deactivation of a still
// signed-in user, isolation and the disabled legacy routes.
// Requires a fresh `node scripts/localdb/setup.mjs reset`.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { activateViaEmail as activateViaEmailWith } from "./lib/mailpit.mjs";
import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const { createBusinessWithOwner } = await import("../../api/_lib/tenantOnboarding.js");
const { default: membersHandler } = await import("../../api/business/members.js");
const { default: workspaceHandler } = await import("../../api/business/workspace.js");
const { default: financeHandler } = await import("../../api/business/finance-actions.js");
const { default: membershipsHandler } = await import("../../api/business/memberships.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (t) => psql(t).stdout.trim();
const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anonClient = () => createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });

const membership = (businessId, userId) =>
  sql(`select coalesce((select role || ':' || active || ':' || coalesce(driver_staff_id, '-') from public.business_memberships where business_id = '${businessId}' and user_id = '${userId}'), 'none');`);
const directory = (businessId) => JSON.parse(sql(`select coalesce(snapshot->'appUsers', '[]'::jsonb)::text from public.workspace_snapshots where business_id = '${businessId}';`));
const driversOf = (businessId) => JSON.parse(sql(`select coalesce(snapshot->'drivers', '[]'::jsonb)::text from public.workspace_snapshots where business_id = '${businessId}';`));
const version = (businessId) => sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${businessId}';`);
const authUserId = (email) => sql(`select coalesce((select id::text from auth.users where lower(email) = lower('${email}')), 'none');`);

const callHandler = async (handler, { method = "GET", token, query = {}, body }) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, headers: { authorization: token ? `Bearer ${token}` : "", host: "127.0.0.1:5175" }, query, body }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* */ }
  return { status: res.statusCode, json };
};
const members = (who, action, fields, businessId) => callHandler(membersHandler, { method: "POST", token: who.token, query: businessId ? { business: businessId } : {}, body: { action, fields } });
const listMembers = (who, businessId) => callHandler(membersHandler, { token: who.token, query: businessId ? { business: businessId } : {} });
const workspace = (who, businessId) => callHandler(workspaceHandler, { token: who.token, query: businessId ? { business: businessId } : {} });
const finance = (who, businessId, action, fields) =>
  callHandler(financeHandler, { method: "POST", token: who.token, query: { business: businessId }, body: { action, requestId: randomUUID(), expectedVersion: version(businessId), fields } });

const signIn = async (email, password = LOCAL_TEST_PASSWORD) => {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { token: data.session.access_token, userId: data.user.id, client };
};

// Password setup through the real email (local Mailpit).
const activateViaEmail = (email) => activateViaEmailWith({ apiUrl: status.apiUrl, anonKey: status.ANON_KEY, email, password: LOCAL_TEST_PASSWORD });

// --- 1. Operator onboarding of three businesses ----------------------------------------
guard();
const pilots = [
  { slug: "pilot-one", name: "Pilot One Taxis", ownerEmail: "owner.one@example.com", ownerName: "Pilot Owner One" },
  { slug: "pilot-two", name: "Pilot Two Taxis", ownerEmail: "owner.two@example.com", ownerName: "Pilot Owner Two" },
  { slug: "pilot-three", name: "Pilot Three Taxis", ownerEmail: "owner.three@example.com", ownerName: "Pilot Owner Three", ownerDrives: true },
];
const created = {};
for (const pilot of pilots) {
  const result = await createBusinessWithOwner(service, { ...pilot, redirectTo: "http://127.0.0.1:5175/" });
  created[pilot.slug] = result;
  record(result.ok && result.status === "created" && result.ownerCreated, `operator creates ${pilot.slug} with a new Owner account`, JSON.stringify({ status: result.status, ownerCreated: result.ownerCreated, setupEmailSent: result.setupEmailSent }));
}
const B1 = created["pilot-one"].businessId;
const B2 = created["pilot-two"].businessId;
const B3 = created["pilot-three"].businessId;

const retry = await createBusinessWithOwner(service, { ...pilots[0], redirectTo: "http://127.0.0.1:5175/" });
record(retry.ok && retry.status === "existing" && retry.businessId === B1 && !retry.ownerCreated, "operator retry is safe (existing, no second business or account)", retry.status);
record(sql("select count(*) from public.businesses where slug like 'pilot-%';") === "3", "exactly three pilot businesses exist");
const taken = await createBusinessWithOwner(service, { slug: "pilot-one", name: "Hijack", ownerEmail: "outsider@example.com", ownerName: "X" });
record(!taken.ok && taken.status === 409 && membership(B1, authUserId("outsider@example.com")) === "none", "a used slug cannot be claimed by another Owner; the account gets no access", taken.error);

for (const pilot of pilots) {
  const activated = await activateViaEmail(pilot.ownerEmail);
  record(activated.ok, `${pilot.ownerEmail} sets a password through the setup email`, activated.error);
}
const owner1 = await signIn("owner.one@example.com");
const owner2 = await signIn("owner.two@example.com");
const owner3 = await signIn("owner.three@example.com");
let res = await workspace(owner1);
record(res.status === 200 && res.json.role === "Owner" && res.json.businessId === B1, "Owner One signs in to their business as Owner", `${res.status} ${res.json.role}`);
res = await workspace(owner3);
record(res.status === 200 && res.json.role === "Owner" && res.json.driverStaffId === "drv-pilot-three-owner", "Owner Three is an owner-driver: one login, Owner role, driver link", `${res.json.driverStaffId}`);

// --- 2. Public users cannot appoint themselves ---------------------------------------
const outsider = await signIn("outsider@example.com");
guard();
let direct = await outsider.client.rpc("create_business_with_owner", { p_slug: "self-made", p_name: "Self", p_owner_user_id: outsider.userId, p_owner_driver_staff_id: null, p_snapshot: {} });
record(Boolean(direct.error), "a signed-in user cannot call the operator business RPC", direct.error?.message);
direct = await outsider.client.rpc("apply_membership_change", { p_business_id: B1, p_actor: outsider.userId, p_user_id: outsider.userId, p_role: "Admin", p_active: true, p_driver_staff_id: null, p_expected_updated_at: new Date().toISOString(), p_snapshot: null });
record(Boolean(direct.error), "a signed-in user cannot call the membership RPC", direct.error?.message);
direct = await outsider.client.rpc("set_business_membership", { p_business_id: B1, p_user_id: outsider.userId, p_role: "Admin" });
record(Boolean(direct.error), "the withdrawn browser membership RPC is refused", direct.error?.message);
guard();
direct = await outsider.client.from("business_memberships").insert({ business_id: B1, user_id: outsider.userId, role: "Owner" });
record(Boolean(direct.error), "a signed-in user cannot insert an Owner membership", direct.error?.message);
direct = await anonClient().from("businesses").insert({ slug: "anon-biz", name: "Anon" });
record(Boolean(direct.error), "anonymous users cannot create businesses", direct.error?.message);
res = await members(outsider, "member.grant", { email: "outsider@example.com", role: "Admin" }, B1);
record(res.status === 403 && membership(B1, outsider.userId) === "none", "a non-member cannot grant itself access through the route", `${res.status} ${res.json.error}`);

// --- 3. Owner grants Admin, Manager (existing account) and Driver -----------------------
res = await members(owner1, "member.grant", { email: "admin.one@example.com", name: "Pilot Admin One", role: "Admin" });
const admin1Id = res.json.userId;
record(res.status === 200 && res.json.accountCreated && res.json.role === "Admin" && membership(B1, admin1Id) === "Admin:true:-", "Owner One grants Admin to a new person", `${res.status} ${JSON.stringify(res.json)}`);
res = await members(owner1, "member.grant", { email: "admin.one@example.com", name: "Pilot Admin One", role: "Admin" });
record(res.status === 200 && !res.json.accountCreated && directory(B1).filter((u) => u.email === "admin.one@example.com").length === 1, "repeating the grant is safe (no second account or directory entry)", `${res.status}`);
const activatedAdmin = await activateViaEmail("admin.one@example.com");
record(activatedAdmin.ok, "the new Admin sets a password through the setup email", activatedAdmin.error);

const managerAId = authUserId("manager@example.com");
const managerAMembershipBefore = membership(BUSINESS_A_ID, managerAId);
res = await members(owner1, "member.grant", { email: "manager@example.com", role: "Manager" });
record(res.status === 200 && !res.json.accountCreated && !res.json.setupEmailSent && membership(B1, managerAId) === "Manager:true:-", "an existing account is granted Manager in Pilot One without a new account", `${res.status}`);
record(membership(BUSINESS_A_ID, managerAId) === managerAMembershipBefore, "the existing account's access to Business A is unchanged", membership(BUSINESS_A_ID, managerAId));
const managerA = await signIn("manager@example.com");
record(!managerA.error, "the existing account's password is unchanged", managerA.error);
res = await callHandler(membershipsHandler, { token: managerA.token });
record(res.status === 200 && res.json.businesses.length === 2, "the existing account now chooses between its two businesses", `${res.json.businesses?.length}`);

// Driver profile first (no sign-in), then a login linked to it.
res = await members(owner1, "driver.save_profile", { name: "Pilot Driver One" });
const driverProfileId = res.json.staffId;
record(res.status === 200 && res.json.created && driversOf(B1).some((d) => d.staffId === driverProfileId), "Owner adds a driver profile without any sign-in", `${res.status} ${driverProfileId}`);
res = await listMembers(owner1);
record(res.status === 200 && res.json.driverProfiles.some((d) => d.staffId === driverProfileId && !d.signInLinked), "the profile is listed as having no sign-in", `${res.status}`);
res = await members(owner1, "member.grant", { email: "driver.one@example.com", role: "Driver" });
record(res.status === 400, "Driver access requires a driver profile", res.json.error);
res = await members(owner1, "member.grant", { email: "driver.one@example.com", role: "Driver", driverStaffId: "drv-not-here" });
record(res.status === 404 && authUserId("driver.one@example.com") === "none", "an unknown profile is refused before any account is created", `${res.status}`);
res = await members(owner1, "member.grant", { email: "driver.one@example.com", name: "Pilot Driver One", role: "Driver", driverStaffId: driverProfileId });
const driver1Id = res.json.userId;
record(res.status === 200 && membership(B1, driver1Id) === `Driver:true:${driverProfileId}`, "Owner grants Driver access linked to the profile", `${res.status}`);
const activatedDriver = await activateViaEmail("driver.one@example.com");
record(activatedDriver.ok, "the new Driver sets a password through the setup email", activatedDriver.error);

// Partial failure: a new account is created, but the link is refused (profile
// already has a sign-in). The new account has no access; a corrected retry works.
res = await members(owner1, "member.grant", { email: "second.driver@example.com", role: "Driver", driverStaffId: driverProfileId });
const orphanId = authUserId("second.driver@example.com");
record(res.status === 409 && res.json.partial?.authUserCreated === true && membership(B1, orphanId) === "none", "a refused link reports the created account and grants nothing", `${res.status} ${JSON.stringify(res.json.partial)}`);
const orphanActivated = await activateViaEmail("second.driver@example.com");
const orphan = orphanActivated.ok ? await signIn("second.driver@example.com") : { error: orphanActivated.error };
res = orphan.token ? await workspace(orphan) : { status: 0 };
record(res.status === 403, "that account cannot read any business (no unintended access)", `${res.status}`);
res = await members(owner1, "driver.save_profile", { name: "Pilot Driver Two" });
const driverTwoProfile = res.json.staffId;
res = await members(owner1, "member.grant", { email: "second.driver@example.com", role: "Driver", driverStaffId: driverTwoProfile });
record(res.status === 200 && !res.json.accountCreated && membership(B1, orphanId) === `Driver:true:${driverTwoProfile}`, "the corrected retry reuses the account and completes", `${res.status}`);

// --- 4. Role access with real tokens --------------------------------------------------
const admin1 = await signIn("admin.one@example.com");
const driver1 = await signIn("driver.one@example.com");
res = await workspace(admin1);
record(res.status === 200 && res.json.role === "Admin" && res.json.businessId === B1, "Admin reads Pilot One as Admin", `${res.status} ${res.json.role}`);
res = await workspace(driver1);
record(res.status === 200 && res.json.role === "Driver" && res.json.scope === "driver" && res.json.driverStaffId === driverProfileId, "Driver reads only the driver projection of its own profile", `${res.status} ${res.json.scope}`);
res = await finance(admin1, B1, "capture.expense", { captureAs: "management", expenseKind: "operational", category: "Fuel", description: "Pilot fuel", expenseDate: "2026-10-09", amount: 50, cashExpense: false });
record(res.status === 200, "Admin can write finance in Pilot One", `${res.status} ${res.json.error ?? ""}`);
res = await listMembers(admin1);
record(res.status === 200 && res.json.members.length >= 4, "Admin can view access in its business", `${res.status}`);
res = await members(admin1, "member.grant", { email: "friend@example.com", role: "Manager" });
record(res.status === 403 && authUserId("friend@example.com") === "none", "Admin cannot grant access", `${res.status}`);
res = await listMembers(driver1);
record(res.status === 403, "Driver cannot view business access", `${res.status}`);

// --- 5. Self-escalation, Owner changes and the last Owner -------------------------------
res = await members(admin1, "member.update", { userId: admin1.userId, role: "Manager" });
record(res.status === 403 && membership(B1, admin1.userId) === "Admin:true:-", "Admin cannot change its own role", `${res.status}`);
res = await members(owner1, "member.grant", { email: "admin.one@example.com", role: "Owner" });
record(res.status === 403 && membership(B1, admin1.userId) === "Admin:true:-", "an Owner cannot appoint another Owner", `${res.status}`);
res = await members(owner1, "member.update", { userId: owner1.userId, role: "Admin" });
record(res.status === 403 && membership(B1, owner1.userId).startsWith("Owner:true"), "an Owner cannot change its own role", `${res.status}`);
res = await members(owner1, "member.deactivate", { userId: owner1.userId });
record(res.status === 403 && membership(B1, owner1.userId).startsWith("Owner:true"), "an Owner cannot remove its own access", `${res.status}`);
guard();
const lastOwner = psql(`update public.business_memberships set active = false where business_id = '${B1}' and user_id = '${owner1.userId}';`, { allowFailure: true });
record(lastOwner.status !== 0 && /at least one active Owner/.test(lastOwner.stderr) && membership(B1, owner1.userId).startsWith("Owner:true"), "the database refuses to deactivate the last active Owner", lastOwner.stderr.trim().split(/\r?\n/)[0]);
const demote = psql(`update public.business_memberships set role = 'Admin' where business_id = '${B1}' and user_id = '${owner1.userId}';`, { allowFailure: true });
record(demote.status !== 0 && membership(B1, owner1.userId).startsWith("Owner:true"), "the database refuses to demote the last active Owner");
const remove = psql(`delete from public.business_memberships where business_id = '${B1}' and user_id = '${owner1.userId}';`, { allowFailure: true });
record(remove.status !== 0 && membership(B1, owner1.userId).startsWith("Owner:true"), "the database refuses to delete the last active Owner");

// --- 6. Owner-driver through one login --------------------------------------------------
res = await finance(owner3, B3, "capture.expense", { captureAs: "driver", expenseKind: "operational", category: "Fuel", description: "Owner-driver fuel", expenseDate: "2026-10-09", amount: 40, cashExpense: true });
record(res.status === 200 && res.json.driverStaffId === "drv-pilot-three-owner", "Owner Three captures its own driving through the driver link", `${res.status} ${res.json.driverStaffId ?? res.json.error}`);
res = await members(owner1, "driver.save_profile", { name: "Pilot Owner One (drives)" });
const owner1Profile = res.json.staffId;
res = await members(owner1, "owner.link_driver", { driverStaffId: owner1Profile });
record(res.status === 200 && membership(B1, owner1.userId) === `Owner:true:${owner1Profile}`, "Owner One links its own login to a driver profile (owner-driver)", `${res.status}`);
res = await members(owner1, "owner.link_driver", { driverStaffId: driverProfileId });
record(res.status === 409 && membership(B1, owner1.userId) === `Owner:true:${owner1Profile}`, "a profile already linked to another login cannot be taken", `${res.status}`);

// --- 7. Cross-business changes and isolation ---------------------------------------------
res = await members(owner1, "member.deactivate", { userId: owner2.userId }, B1);
record(res.status === 404 && membership(B2, owner2.userId).startsWith("Owner:true"), "Owner One cannot change a person who is not in Pilot One", `${res.status}`);
res = await members(owner1, "member.grant", { email: "x2@example.com", role: "Admin" }, B2);
record(res.status === 403 && authUserId("x2@example.com") === "none", "Owner One cannot manage Pilot Two", `${res.status}`);
res = await workspace(owner1, B2);
record(res.status === 403, "Owner One cannot read Pilot Two", `${res.status}`);
res = await listMembers(owner2);
record(res.status === 200 && res.json.members.length === 1 && res.json.members[0].email === "owner.two@example.com", "Pilot Two's access list shows only Pilot Two", `${res.json.members?.map((m) => m.email).join(",")}`);
res = await workspace(admin1, B3);
record(res.status === 403, "Pilot One's Admin cannot read Pilot Three", `${res.status}`);
res = await finance(driver1, B2, "capture.expense", { expenseKind: "operational", category: "Fuel", description: "x", expenseDate: "2026-10-09", amount: 1 });
record(res.status === 403, "Pilot One's Driver cannot write to Pilot Two", `${res.status}`);

// --- 8. Deactivation blocks a still-signed-in user ---------------------------------------
res = await members(owner1, "member.deactivate", { userId: admin1.userId });
record(res.status === 200 && membership(B1, admin1.userId) === "Admin:false:-" && directory(B1).find((u) => u.email === "admin.one@example.com")?.active === false, "Owner One removes the Admin's access (membership and directory)", `${res.status}`);
res = await workspace(admin1);
record(res.status === 403, "the same Admin token can no longer read", `${res.status}`);
res = await finance(admin1, B1, "capture.expense", { captureAs: "management", expenseKind: "operational", category: "Fuel", description: "after removal", expenseDate: "2026-10-09", amount: 5 });
record(res.status === 403, "the same Admin token can no longer write", `${res.status}`);
res = await callHandler(membershipsHandler, { token: admin1.token });
record(res.status === 200 && res.json.businesses.length === 0, "the removed Admin lists no businesses", `${res.json.businesses?.length}`);
res = await members(owner1, "member.reactivate", { userId: admin1.userId });
const back = await workspace(admin1);
record(res.status === 200 && back.status === 200, "restoring access works again for the same login", `${res.status}/${back.status}`);
res = await members(owner1, "member.deactivate", { userId: driver1Id });
const driverAfter = await workspace(driver1);
record(res.status === 200 && driverAfter.status === 403 && driversOf(B1).some((d) => d.staffId === driverProfileId), "removing a Driver's sign-in keeps the driver profile", `${driverAfter.status}`);
res = await members(owner1, "member.deactivate", { userId: managerAId });
const managerStillA = await workspace(managerA, BUSINESS_A_ID);
record(res.status === 200 && managerStillA.status === 200 && membership(BUSINESS_A_ID, managerAId) === managerAMembershipBefore, "removing access in Pilot One leaves Business A access intact", `${managerStillA.status}`);

// --- 9. Legacy user and bootstrap routes are disabled in tenant mode ---------------------
process.env.TAXIFLOW_TENANT_MODE = "true";
const { POST: legacyUsers } = await import("../../api/admin/auth-users.js");
const { POST: legacyBootstrap } = await import("../../api/admin/bootstrap-workspace.js");
const legacyRequest = (body) => new Request("http://127.0.0.1:5175/api/admin/x", { method: "POST", headers: { authorization: `Bearer ${owner1.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const legacyUserResponse = await legacyUsers(legacyRequest({ action: "create", email: "legacy@example.com", role: "Owner", password: "x" }));
record(legacyUserResponse.status === 410 && authUserId("legacy@example.com") === "none", "legacy user route is disabled in tenant mode", `${legacyUserResponse.status}`);
const legacyBootstrapResponse = await legacyBootstrap(legacyRequest({ snapshot: {} }));
record(legacyBootstrapResponse.status === 410, "legacy bootstrap route is disabled in tenant mode", `${legacyBootstrapResponse.status}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
