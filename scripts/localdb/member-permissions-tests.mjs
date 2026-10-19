#!/usr/bin/env node
// Owner-assigned responsibilities and tenant route / vehicle / driver saves
// (release 06) against the LOCAL TEST stack with REAL local Auth:
//   TAXIFLOW_LOCALDB_PROFILE=test node scripts/localdb/setup.mjs reset
//   TAXIFLOW_LOCALDB_PROFILE=test node scripts/localdb/member-permissions-tests.mjs
// Proves, through the real API handlers and database: allowed and refused
// actions for every responsibility; removing a responsibility blocks the very
// next direct request; module access is never bypassed; delegated driver
// management cannot touch sign-ins, roles or responsibilities; no
// self-escalation; cross-company reads/writes and forged ids are refused;
// Owner protections and Driver privacy hold; stale versions write nothing.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { ACTIVE_PROFILE } from "./lib/localTarget.mjs";
import { PERMISSION_KEYS } from "../../src/lib/memberPermissions.js";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

if (ACTIVE_PROFILE.name !== "test") {
  console.error("Run with TAXIFLOW_LOCALDB_PROFILE=test on a freshly reset test stack.");
  process.exit(2);
}
const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const { default: membersHandler } = await import("../../api/business/members.js");
const { default: workspaceHandler } = await import("../../api/business/workspace.js");
const { default: financeHandler } = await import("../../api/business/finance-actions.js");

const results = [];
const record = (ok, name, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (text) => psql(text).stdout.trim();
const snapshotOf = (businessId) => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${businessId}';`));
const version = (businessId) => sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${businessId}';`);
const permsOf = (businessId, userId) => sql(`select array_to_string(permissions, ',') from public.business_memberships where business_id = '${businessId}' and user_id = '${userId}';`);
const membershipsHash = () => sql("select md5(string_agg(business_id::text||user_id::text||role||active::text||coalesce(driver_staff_id,''), ',' order by business_id, user_id)) from public.business_memberships;");
const authUsersHash = () => sql("select md5(string_agg(id::text||email||coalesce(encrypted_password,''), ',' order by id)) from auth.users;");
const stable = (value) => JSON.stringify(value ?? null);

const callHandler = async (handler, { method = "GET", token, query = {}, body }) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  // A call that never answers is a failure to report, not a silent hang.
  const watchdog = setTimeout(() => {
    console.log(`FAIL no answer within 20s: ${method} ${body?.action ?? "(read)"}`);
    process.exit(1);
  }, 20_000);
  await handler({ method, headers: { authorization: token ? `Bearer ${token}` : "", host: "127.0.0.1:5176" }, query, body }, res);
  clearTimeout(watchdog);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* not JSON */ }
  return { status: res.statusCode, json };
};
const members = (who, action, fields, businessId = BUSINESS_A_ID) => callHandler(membersHandler, { method: "POST", token: who.token, query: { business: businessId }, body: { action, fields } });
const listMembers = (who, businessId = BUSINESS_A_ID) => callHandler(membersHandler, { token: who.token, query: { business: businessId } });
const workspace = (who, businessId = BUSINESS_A_ID) => callHandler(workspaceHandler, { token: who.token, query: { business: businessId } });
const act = (who, action, fields, { businessId = BUSINESS_A_ID, requestId = randomUUID(), expectedVersion } = {}) =>
  callHandler(financeHandler, { method: "POST", token: who.token, query: { business: businessId }, body: { action, requestId, expectedVersion: expectedVersion ?? version(businessId), fields } });

const signIn = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return { token: data.session.access_token, userId: data.user.id, email };
};
const setPerms = (permissions, who, target) => members(who, "member.permissions", { userId: target.userId, permissions });

guard();
const ownerA = await signIn("owner@example.com");
const adminA = await signIn("admin@example.com");
const managerA = await signIn("manager@example.com");
const driverA = await signIn("driver@example.com");
const ownerB = await signIn("owner.b@example.com");
const managerB = await signIn("manager.b@example.com");
const outsider = await signIn("outsider@example.com");
const initialB = snapshotOf(BUSINESS_B_ID);
const initialMoneyA = stable(["financeTransactions", "dailyCashUps", "deposits"].map((key) => snapshotOf(BUSINESS_A_ID)[key]));

// --- 1. Migration preserved the effective rules; the server reports them --------------------
let r = await workspace(adminA);
record(r.status === 200 && stable(r.json.permissions) === stable(["cash.count"]), "Admin starts with the pre-06 rule: receive and count cash only", stable(r.json.permissions));
r = await workspace(managerA);
record(r.status === 200 && stable([...r.json.permissions].sort()) === stable(["cash.bank", "cash.verify"]), "Manager starts with the pre-06 rule: verify and bank", stable(r.json.permissions));
r = await workspace(ownerA);
record(stable([...(r.json.permissions ?? [])].sort()) === stable([...PERMISSION_KEYS].sort()), "Owner holds every responsibility", stable(r.json.permissions));
r = await workspace(driverA);
record(r.status === 200 && stable(r.json.permissions) === "[]", "Driver holds none");

// --- 2. Only the Owner changes responsibilities; no delegation, no self-escalation ------------
const shapeBefore = membershipsHash();
r = await setPerms(["cash.count", "cash.verify", "cash.bank", "fleet.manage", "drivers.manage"], managerA, managerA);
record(r.status === 403 && permsOf(BUSINESS_A_ID, managerA.userId) === "cash.verify,cash.bank", "a Manager cannot raise their own responsibilities", `${r.status}`);
r = await setPerms(["cash.bank"], adminA, adminA);
record(r.status === 403 && permsOf(BUSINESS_A_ID, adminA.userId) === "cash.count", "an Admin cannot raise their own responsibilities", `${r.status}`);
r = await setPerms(["cash.bank"], adminA, managerA);
record(r.status === 403, "an Admin cannot change another member's responsibilities", `${r.status}`);
r = await setPerms(["cash.bank"], driverA, adminA);
record(r.status === 403, "a Driver cannot change responsibilities", `${r.status}`);
r = await setPerms(["cash.count"], ownerA, ownerA);
record(r.status === 403, "the Owner cannot change their own entry", `${r.status}`);
r = await setPerms(["cash.count"], ownerA, driverA);
record(r.status === 403, "a Driver cannot be given staff responsibilities", `${r.status}`);
r = await setPerms(["cash.count", "platform.admin"], ownerA, adminA);
record(r.status === 400 && permsOf(BUSINESS_A_ID, adminA.userId) === "cash.count", "unknown responsibilities are refused", `${r.status}`);
record(membershipsHash() === shapeBefore, "no refused change altered any membership");

// --- 3. cash.count -------------------------------------------------------------------------------
r = await setPerms([], ownerA, adminA);
record(r.status === 200 && permsOf(BUSINESS_A_ID, adminA.userId) === "", "Owner removes counting from the Admin", `${r.status}`);
r = await act(adminA, "cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 });
record(r.status === 403 && /Receive and count cash/.test(r.json.error ?? ""), "the next hand-in by that Admin is refused", `${r.status} ${r.json.error ?? ""}`);
r = await act(managerA, "cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 });
record(r.status === 403, "a Manager without counting cannot record a hand-in", `${r.status}`);
r = await setPerms(["cash.count"], ownerA, adminA);
r = await act(adminA, "cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 });
record(r.status === 200 && snapshotOf(BUSINESS_A_ID).dailyCashUps.find((c) => c.id === "uat-cu-1").status === "counted", "with counting restored the Admin records the hand-in", `${r.status}`);

// --- 4. cash.verify ------------------------------------------------------------------------------
r = await act(adminA, "cashup.verify", { cashUpId: "uat-cu-1" });
record(r.status === 403 && /Verify counted cash/.test(r.json.error ?? ""), "an Admin restricted to counting cannot verify", `${r.status}`);
r = await setPerms(["cash.bank"], ownerA, managerA);
r = await act(managerA, "cashup.verify", { cashUpId: "uat-cu-1" });
record(r.status === 403, "a Manager whose verification was removed is refused on the next request", `${r.status}`);
r = await act(managerA, "income.verify", { recordId: "uat-fin-6" });
record(r.status === 403, "...also for standalone income verification", `${r.status}`);
r = await setPerms(["cash.bank", "cash.verify"], ownerA, managerA);
r = await act(managerA, "cashup.verify", { cashUpId: "uat-cu-1" });
record(r.status === 200 && snapshotOf(BUSINESS_A_ID).dailyCashUps.find((c) => c.id === "uat-cu-1").status === "verified", "with verification restored the Manager verifies", `${r.status}`);

// --- 5. cash.bank: removal blocks the very next direct request ----------------------------------
const BATCH = { cashUpIds: ["uat-cu-1"], transactionIds: ["uat-fin-1", "uat-fin-2", "uat-fin-3"] };
r = await setPerms(["cash.verify"], ownerA, managerA);
record(r.status === 200 && permsOf(BUSINESS_A_ID, managerA.userId) === "cash.verify", "Owner removes banking from the Manager", `${r.status}`);
const versionBeforeBank = version(BUSINESS_A_ID);
r = await act(managerA, "deposit.lock", BATCH);
record(r.status === 403 && /Bank verified cash/.test(r.json.error ?? "") && version(BUSINESS_A_ID) === versionBeforeBank, "the Manager's next direct banking request is refused and writes nothing", `${r.status} ${r.json.error ?? ""}`);
r = await act(adminA, "deposit.lock", BATCH);
record(r.status === 403, "an Admin without banking cannot bank", `${r.status}`);
r = await setPerms(["cash.verify", "cash.bank"], ownerA, managerA);
r = await act(managerA, "deposit.lock", BATCH);
record(r.status === 200 && snapshotOf(BUSINESS_A_ID).dailyCashUps.find((c) => c.id === "uat-cu-1").status === "banked", "with banking restored the Manager banks the verified batch", `${r.status} ${r.json.error ?? ""}`);

// --- 6. fleet.manage: routes and vehicles --------------------------------------------------------
const route = { name: "Rank to Mall", code: "RM1", primaryOrigin: "Rank", primaryDestination: "Mall" };
r = await act(managerA, "route.save", route);
record(r.status === 403 && /Manage routes and vehicles/.test(r.json.error ?? ""), "a Manager without fleet management cannot add a route", `${r.status}`);
r = await setPerms(["cash.verify", "cash.bank", "fleet.manage"], ownerA, managerA);
r = await act(managerA, "route.save", route);
const savedRoute = snapshotOf(BUSINESS_A_ID).routes.find((entry) => entry.id === r.json.routeId);
record(r.status === 200 && savedRoute?.name === "Rank to Mall" && savedRoute.createdBy === managerA.userId, "with fleet management the Manager adds a route (stored in the database)", `${r.status} ${r.json.routeId}`);
r = await act(managerA, "route.save", { ...route, code: "RM2" });
record(r.status === 409, "a second route with the same name is refused", `${r.status}`);
r = await act(managerA, "route.save", { routeId: "uat-route-a", name: "Renamed Route", primaryOrigin: "A", primaryDestination: "B" });
record(r.status === 409 && /money records/.test(r.json.error ?? ""), "renaming a route used by money records is refused", `${r.status}`);
r = await act(managerA, "vehicle.save", { registration: "RM 100 GP", model: "Quantum", routeId: savedRoute?.id });
const savedVehicle = snapshotOf(BUSINESS_A_ID).vehicles.find((entry) => entry.id === r.json.vehicleId);
record(r.status === 200 && savedVehicle?.route === "Rank to Mall" && savedVehicle.status === "active", "the Manager adds a vehicle on that route", `${r.status} ${r.json.vehicleId}`);
r = await act(managerA, "vehicle.save", { vehicleId: "uat-veh-02", registration: "UAT-TEST-02", model: "UAT Minibus", routeId: "uat-route-a", assignedDriverId: "uat-drv-01" });
record(r.status === 403 && /Manage driver profiles/.test(r.json.error ?? ""), "changing a vehicle's driver also needs driver management", `${r.status}`);
r = await act(adminA, "route.save", { ...route, name: "Admin Route" });
record(r.status === 403, "an Admin without fleet management cannot add a route", `${r.status}`);
r = await act(driverA, "route.save", { ...route, name: "Driver Route" });
record(r.status === 403, "a Driver cannot add a route", `${r.status}`);

// --- 7. drivers.manage: profiles and assignments, never sign-ins ----------------------------------
r = await act(managerA, "driver.save", { name: "New Driver" });
record(r.status === 403, "a Manager without driver management cannot add a driver profile", `${r.status}`);
r = await members(managerA, "driver.save_profile", { name: "New Driver" });
record(r.status === 403, "...also not through Business access", `${r.status}`);
r = await setPerms(["cash.verify", "cash.bank", "fleet.manage", "drivers.manage"], ownerA, managerA);
r = await act(managerA, "driver.save", { name: "New Driver", routeIds: [savedRoute?.id], prdpExpiryDate: "2027-03-31" });
const savedDriver = snapshotOf(BUSINESS_A_ID).drivers.find((entry) => entry.staffId === r.json.staffId);
record(r.status === 200 && savedDriver?.route === "Rank to Mall" && savedDriver.prdpExpiryDate === "2027-03-31" && !savedDriver.email, "with driver management the Manager adds a driver profile (no email, no sign-in)", `${r.status} ${r.json.staffId}`);
r = await members(managerA, "driver.save_profile", { name: "Profile Via Settings" });
record(r.status === 200, "...and through Business access", `${r.status}`);
r = await act(managerA, "vehicle.save", { vehicleId: "uat-veh-02", registration: "UAT-TEST-02", model: "UAT Minibus", routeId: "uat-route-a", assignedDriverId: "uat-drv-01" });
const afterAssign = snapshotOf(BUSINESS_A_ID).vehicles;
record(r.status === 200 && afterAssign.find((v) => v.id === "uat-veh-02").assignedDriverId === "uat-drv-01" && afterAssign.find((v) => v.id === "uat-veh-01").assignedDriverId === null, "the Manager moves a driver to another vehicle (previous vehicle released)", `${r.status}`);
r = await act(managerA, "driver.save", { name: "With Login", email: "with.login@example.com" });
record(r.status === 400, "a driver profile save cannot carry an email", `${r.status}`);
r = await act(managerA, "driver.save", { name: "With Login", enableLogin: true, accessPassword: "x" });
record(r.status === 400, "...nor a sign-in or password", `${r.status}`);
const authBefore = authUsersHash();
const shapeDelegated = membershipsHash();
r = await members(managerA, "member.grant", { email: "delegated.login@example.com", role: "Driver", driverStaffId: savedDriver?.staffId });
record(r.status === 403, "driver management cannot grant a sign-in", `${r.status}`);
r = await members(managerA, "member.update", { userId: adminA.userId, role: "Manager" });
record(r.status === 403, "driver management cannot change a role", `${r.status}`);
r = await members(managerA, "member.deactivate", { userId: adminA.userId });
record(r.status === 403, "driver management cannot remove access", `${r.status}`);
r = await setPerms(["cash.bank"], managerA, adminA);
record(r.status === 403, "driver management cannot change responsibilities", `${r.status}`);
r = await members(managerA, "owner.link_driver", { driverStaffId: savedDriver?.staffId });
record(r.status === 403, "driver management cannot link a sign-in to a driver profile", `${r.status}`);
record(authUsersHash() === authBefore && membershipsHash() === shapeDelegated, "no Auth account and no membership changed");

// --- 8. Module access is never bypassed -------------------------------------------------------
r = await members(ownerA, "member.update", { userId: managerA.userId, moduleAccess: { fleet: false } });
record(r.status === 200, "Owner switches Fleet off for the Manager", `${r.status}`);
r = await act(managerA, "route.save", { ...route, name: "Blocked Route" });
record(r.status === 403 && permsOf(BUSINESS_A_ID, managerA.userId).includes("fleet.manage"), "fleet management is inactive while the Fleet module is off", `${r.status}`);
r = await workspace(managerA);
record(!r.json.permissions.includes("fleet.manage"), "the workspace reports it as inactive");
r = await members(ownerA, "member.update", { userId: managerA.userId, moduleAccess: { fleet: true } });
r = await act(managerA, "route.save", { ...route, name: "Allowed Again", code: "AA1" });
record(r.status === 200, "with Fleet back on the same request is allowed", `${r.status}`);

// --- 9. Cross-company reads/writes and forged ids --------------------------------------------
r = await act(managerB, "route.save", { ...route, name: "B into A" });
record(r.status === 403, "a Manager of B cannot save into A", `${r.status} ${r.json.error ?? ""}`);
r = await act(managerA, "route.save", { ...route, name: "A into B" }, { businessId: BUSINESS_B_ID });
record(r.status === 403, "a Manager of A cannot save into B", `${r.status}`);
r = await workspace(managerA, BUSINESS_B_ID);
record(r.status === 403, "a Manager of A cannot read B's workspace", `${r.status}`);
r = await listMembers(ownerA, BUSINESS_B_ID);
record(r.status === 403, "an Owner of A cannot read B's access list", `${r.status}`);
r = await setPerms(["cash.bank"], ownerA, managerB);
record(r.status === 404, "an Owner of A cannot change a member of B", `${r.status}`);
r = await members(ownerA, "member.permissions", { userId: managerB.userId, permissions: ["cash.bank"] }, BUSINESS_B_ID);
record(r.status === 403 && permsOf(BUSINESS_B_ID, managerB.userId) === "cash.verify,cash.bank", "...not even by selecting business B", `${r.status}`);
r = await act(outsider, "route.save", { ...route, name: "Outsider" });
record(r.status === 403, "a signed-in account without membership cannot save", `${r.status}`);
r = await act(managerA, "vehicle.save", { vehicleId: "uat-veh-01-b", registration: "UAT-TEST-01-B", model: "X", routeId: "uat-route-a" });
record(r.status === 404, "a forged vehicle id from B is refused in A", `${r.status}`);
r = await act(managerA, "vehicle.save", { vehicleId: "uat-veh-02", registration: "UAT-TEST-02", model: "UAT Minibus", routeId: "uat-route-a", assignedDriverId: "uat-drv-b-01" });
record(r.status === 404, "assigning B's driver to an A vehicle is refused", `${r.status}`);
r = await act(managerA, "driver.save", { staffId: "uat-drv-b-owner", name: "Hijack" });
record(r.status === 404, "editing B's driver profile from A is refused", `${r.status}`);
r = await act(managerA, "vehicle.save", { registration: "XB 1", model: "X", routeId: "route-from-elsewhere" });
record(r.status === 404, "a route id that is not in A is refused", `${r.status}`);
r = await act(managerA, "route.save", { ...route, name: "With Business", businessId: BUSINESS_B_ID });
record(r.status === 400, "a business id in the fields is refused", `${r.status}`);
record(stable(snapshotOf(BUSINESS_B_ID)) === stable(initialB), "Business B is completely unchanged");

// --- 10. Concurrency, replay, protected data ----------------------------------------------
const stale = "2026-01-01T00:00:00.000000Z";
const versionBeforeStale = version(BUSINESS_A_ID);
r = await act(ownerA, "route.save", { ...route, name: "Stale Route" }, { expectedVersion: stale });
record(r.status === 409 && version(BUSINESS_A_ID) === versionBeforeStale, "a stale version writes nothing", `${r.status}`);
const requestId = randomUUID();
const replayFields = { ...route, name: "Replay Route", code: "RP1" };
const first = await act(ownerA, "route.save", replayFields, { requestId });
const second = await act(ownerA, "route.save", replayFields, { requestId, expectedVersion: versionBeforeStale });
record(first.status === 200 && second.status === 200 && second.json.replayed === true && snapshotOf(BUSINESS_A_ID).routes.filter((entry) => entry.name === "Replay Route").length === 1, "a retried request is applied once", `${first.status}/${second.status}`);
const moneyAfter = snapshotOf(BUSINESS_A_ID);
const moneyRecords = moneyAfter.financeTransactions.filter((t) => !["uat-fin-1", "uat-fin-2", "uat-fin-3"].includes(t.id));
const initialRecords = JSON.parse(initialMoneyA)[0].filter((t) => !["uat-fin-1", "uat-fin-2", "uat-fin-3"].includes(t.id));
record(stable(moneyRecords) === stable(initialRecords), "fleet and driver saves left every other money record unchanged");
record(moneyAfter.dailyCashUps.find((c) => c.id === "uat-cu-1").status === "banked" && moneyAfter.financeTransactions.find((t) => t.id === "uat-fin-6").status === "counted", "finance statuses are only the ones the cash steps set");

// --- 11. Owner protections and Driver privacy -----------------------------------------------
r = await members(managerA, "member.deactivate", { userId: ownerA.userId });
record(r.status === 403, "a Manager cannot remove the Owner", `${r.status}`);
const ownerRow = sql(`select role||':'||active from public.business_memberships where business_id='${BUSINESS_A_ID}' and user_id='${ownerA.userId}';`);
record(ownerRow === "Owner:true", "the Owner membership is unchanged", ownerRow);
r = await listMembers(driverA);
record(r.status === 403, "a Driver cannot read the access list or anyone's responsibilities", `${r.status}`);
r = await workspace(driverA);
const driverView = r.json.snapshot ?? {};
record(
  r.status === 200 &&
    (driverView.appUsers ?? []).length === 1 &&
    (driverView.dailyCashUps ?? []).every((c) => c.driverStaffId === "uat-drv-01") &&
    (driverView.auditTrail ?? []).every((event) => event.actorId !== managerA.userId) &&
    (driverView.drivers ?? []).every((d) => d.cashAccuracy === undefined && d.avgShiftRevenue === undefined),
  "a Driver sees only their own records, no staff audit and no other staff data",
);
r = await listMembers(ownerA);
const listedManager = r.json.members?.find((m) => m.userId === managerA.userId);
record(r.status === 200 && stable([...listedManager.permissions].sort()) === stable(["cash.bank", "cash.verify", "drivers.manage", "fleet.manage"]), "the Owner sees the Manager's responsibilities in Business access");
const audits = snapshotOf(BUSINESS_A_ID).auditTrail.filter((event) => event.title === "Responsibilities changed");
record(audits.length === 8 && audits.every((event) => event.actorId === ownerA.userId), "every responsibility change is in the audit trail, by the Owner", `${audits.length}`);

// --- 12. Delegated staff-responsibility management (staff.manage) ---------------------------
const auditRows = (businessId, actorId) => Number(sql(`select count(*) from public.member_permission_changes where business_id = '${businessId}' and actor_user_id = '${actorId}';`));
const staffManagersBefore = membershipsHash();
r = await setPerms(["cash.count", "staff.manage"], adminA, managerA);
record(r.status === 403, "without staff.manage an Admin cannot change anyone's responsibilities", `${r.status}`);
r = await setPerms(["cash.count", "staff.manage"], ownerA, adminA);
record(r.status === 200 && permsOf(BUSINESS_A_ID, adminA.userId) === "cash.count,staff.manage", "the Owner gives the Admin staff management", `${r.status}`);
r = await listMembers(managerA);
record(r.status === 403, "a Manager without staff.manage cannot read the access list", `${r.status}`);
const managerBefore = permsOf(BUSINESS_A_ID, managerA.userId);
r = await setPerms(managerBefore.split(",").filter((key) => key !== "fleet.manage"), adminA, managerA);
record(r.status === 403 && /hold yourself/.test(r.json.error ?? "") && permsOf(BUSINESS_A_ID, managerA.userId) === managerBefore, "a staff manager cannot remove a responsibility it does not hold", `${r.status}`);
r = await setPerms([...managerBefore.split(","), "cash.count"], adminA, managerA);
record(r.status === 200 && permsOf(BUSINESS_A_ID, managerA.userId).split(",").includes("cash.count"), "a staff manager gives a responsibility it holds (counting)", `${r.status}`);
r = await setPerms(managerBefore.split(","), adminA, managerA);
record(r.status === 200 && permsOf(BUSINESS_A_ID, managerA.userId) === managerBefore, "...and removes it again", `${r.status}`);
r = await setPerms([...managerBefore.split(","), "staff.manage"], adminA, managerA);
record(r.status === 403 && !permsOf(BUSINESS_A_ID, managerA.userId).includes("staff.manage"), "a staff manager cannot pass staff management on", `${r.status}`);
r = await setPerms(["cash.count", "staff.manage", "cash.bank"], adminA, adminA);
record(r.status === 403 && permsOf(BUSINESS_A_ID, adminA.userId) === "cash.count,staff.manage", "a staff manager cannot raise its own responsibilities", `${r.status}`);
r = await setPerms(["cash.count"], adminA, ownerA);
record(r.status === 403, "a staff manager cannot change the Owner", `${r.status}`);
r = await setPerms(["cash.count"], adminA, driverA);
record(r.status === 403, "a staff manager cannot give a Driver responsibilities", `${r.status}`);
r = await setPerms(["cash.count"], adminA, managerB);
record(r.status === 404 && permsOf(BUSINESS_B_ID, managerB.userId) === "cash.verify,cash.bank", "a staff manager of A cannot change a member of B", `${r.status}`);
r = await members(adminA, "member.grant", { email: "staffmgr.grant@example.com", role: "Manager" });
record(r.status === 403, "staff management cannot grant sign-ins", `${r.status}`);
r = await members(adminA, "member.update", { userId: managerA.userId, role: "Admin" });
record(r.status === 403, "staff management cannot change roles", `${r.status}`);
r = await setPerms([...managerBefore.split(","), "staff.manage"], ownerA, managerA);
r = await setPerms(managerBefore.split(",").concat("staff.manage").filter((key) => key !== "cash.verify"), adminA, managerA);
record(r.status === 403 && /manages staff/.test(r.json.error ?? ""), "a staff manager cannot change another staff manager", `${r.status}`);
r = await setPerms(managerBefore.split(","), ownerA, managerA);
record(r.status === 200, "the Owner removes the Manager's staff management", `${r.status}`);
r = await setPerms(["cash.count"], ownerA, adminA);
r = await setPerms([...managerBefore.split(","), "cash.count"], adminA, managerA);
record(r.status === 403, "removing staff management blocks the very next delegated change", `${r.status}`);
// Database rule, independent of the API: a staff manager calling the function directly is held to the same limits.
const directBeyond = psql(`select public.set_member_permissions('${BUSINESS_A_ID}', '${managerA.userId}', '${adminA.userId}', array['cash.bank']::text[], null, null);`, { allowFailure: true });
record(directBeyond.status !== 0, "the database function refuses a non-holder directly too", directBeyond.stderr.trim().split("\n").pop());
record(auditRows(BUSINESS_A_ID, adminA.userId) === 2 && auditRows(BUSINESS_B_ID, adminA.userId) === 0, "each delegated change is one audit row in business A only", `${auditRows(BUSINESS_A_ID, adminA.userId)}`);
const lastAudit = sql(`select actor_role||'|'||array_to_string(permissions_before, ',')||'|'||array_to_string(permissions_after, ',') from public.member_permission_changes where business_id = '${BUSINESS_A_ID}' and actor_user_id = '${adminA.userId}' order by changed_at desc limit 1;`);
record(lastAudit.startsWith("Admin|") && lastAudit.split("|")[1].includes("cash.count") && !lastAudit.split("|")[2].includes("cash.count"), "audit rows record the actor's role and before/after", lastAudit);
const browserAudit = await createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ownerA.token}` } } }).from("member_permission_changes").select("id");
record(Boolean(browserAudit.error) || (browserAudit.data ?? []).length === 0, "a browser (even the Owner's) cannot read the audit table", browserAudit.error?.code ?? `${(browserAudit.data ?? []).length} rows`);
record(membershipsHash() === staffManagersBefore, "roles, activity and driver links unchanged by delegated management");

// --- 13. Separation of duties: the counter never verifies its own count ------------------
r = await setPerms([...managerBefore.split(","), "cash.count"], ownerA, managerA);
record(permsOf(BUSINESS_A_ID, managerA.userId).includes("cash.count") && permsOf(BUSINESS_A_ID, managerA.userId).includes("cash.verify"), "a Manager may hold both counting and verifying");
r = await act(managerA, "income.count", { recordId: "uat-fin-7", actualCashReceived: 300 });
record(r.status === 200, "the Manager counts standalone income", `${r.status} ${r.json.error ?? ""}`);
r = await act(managerA, "income.verify", { recordId: "uat-fin-7" });
record(r.status === 403 && /another authorized person/.test(r.json.error ?? "") && snapshotOf(BUSINESS_A_ID).financeTransactions.find((t) => t.id === "uat-fin-7").status === "counted", "a direct request to verify its own count is refused", `${r.status}`);
r = await act(ownerA, "income.verify", { recordId: "uat-fin-7" });
record(r.status === 200 && snapshotOf(BUSINESS_A_ID).financeTransactions.find((t) => t.id === "uat-fin-7").verifiedBy === ownerA.userId, "another authorized person (the Owner) verifies it", `${r.status}`);
r = await act(driverA, "cashup.submit", { workDate: "2026-10-02" });
const dayId = r.json.cashUpId;
record(r.status === 200 && Boolean(dayId), "a Driver submits another day checking", `${r.status} ${dayId}`);
r = await act(managerA, "cashup.record_handin", { cashUpId: dayId, actualCashReceived: 250 });
record(r.status === 200, "the Manager records that day's hand-in", `${r.status}`);
r = await act(managerA, "cashup.verify", { cashUpId: dayId });
record(r.status === 403 && /another authorized person/.test(r.json.error ?? ""), "the same Manager cannot verify that day (direct API)", `${r.status}`);
r = await act(ownerA, "cashup.verify", { cashUpId: dayId });
record(r.status === 200 && snapshotOf(BUSINESS_A_ID).dailyCashUps.find((c) => c.id === dayId).status === "verified", "another authorized person verifies the day", `${r.status}`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
