#!/usr/bin/env node
// Integration proof of capture.standard_income / capture.special_income /
// capture.expense via POST /api/business/finance-actions against the LOCAL
// synthetic stack with REAL local Auth tokens. Requires a fresh
// `node scripts/localdb/setup.mjs reset`. Local target and loopback-only
// bindings are re-verified before every mutation attempt.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { stableStringify } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;
const { default: handler } = await import("../../api/business/finance-actions.js");

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
const version = (b) => sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${b}';`);
const snapshotOf = (b) => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${b}';`));
const rowState = (b) => sql(`select md5(snapshot::text) from public.workspace_snapshots where business_id = '${b}';`);
const findRecord = (b, id) => snapshotOf(b).financeTransactions.find((t) => t.id === id);

const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { token: data.session.access_token, userId: data.user.id };
};
const post = async (who, body, query = {}) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${who.token}` }, query, body }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* */ }
  return { status: res.statusCode, json };
};
const req = (action, fields, b, extra = {}) => ({ action, requestId: randomUUID(), expectedVersion: version(b), fields, ...extra });

const legs = [
  { fromLocation: "Noord", toLocation: "Alexandra", passengerCount: 12, amountCollected: 500 },
  { fromLocation: "Alexandra", toLocation: "Noord", passengerCount: 9, amountCollected: 420 },
];
const standard = (overrides = {}) => ({ vehicleId: "uat-veh-01", tripDate: "2026-10-02", timeIn: "06:00", timeOut: "10:00", openingOdo: 1000, closingOdo: 1080, tripLogbook: legs, ...overrides });
const special = (overrides = {}) => ({ vehicleId: "uat-veh-02", tripDate: "2026-10-02", openingOdo: 2000, closingOdo: 2030, fromLocation: "Depot", toLocation: "Airport", travelReason: "UAT charter", fuelOilCost: 50, repairMaintenanceCost: 0, amount: 350, ...overrides });
const expense = (overrides = {}) => ({ expenseKind: "operational", category: "Fuel", description: "UAT fuel top-up", expenseDate: "2026-10-02", amount: 120, cashExpense: true, ...overrides });

const ownerA = await tokenFor("owner@example.com");
const adminA = await tokenFor("admin@example.com");
const managerA = await tokenFor("manager@example.com");
const driverA = await tokenFor("driver@example.com");
const ownerB = await tokenFor("owner.b@example.com");
const driverB = await tokenFor("driver.b@example.com");

const initialA = snapshotOf(BUSINESS_A_ID);
const initialBState = rowState(BUSINESS_B_ID);
let stateA = rowState(BUSINESS_A_ID);

// --- Forged / invalid input (all 400, nothing written) ---------------------------------
const invalid = [
  ["whole snapshot in the body", { ...req("capture.standard_income", standard(), BUSINESS_A_ID), snapshot: {} }],
  ["forged role field", req("capture.standard_income", standard({ role: "Owner" }), BUSINESS_A_ID)],
  ["forged driver staff id", req("capture.standard_income", standard({ driverStaffId: "uat-drv-b-01" }), BUSINESS_A_ID)],
  ["forged status", req("capture.expense", expense({ status: "verified" }), BUSINESS_A_ID)],
  ["unknown trip-leg field", req("capture.standard_income", standard({ tripLogbook: [{ ...legs[0], amountClaimed: 9999 }] }), BUSINESS_A_ID)],
  ["negative leg amount", req("capture.standard_income", standard({ tripLogbook: [{ ...legs[0], amountCollected: -5 }] }), BUSINESS_A_ID)],
  ["fractional passenger count", req("capture.standard_income", standard({ tripLogbook: [{ ...legs[0], passengerCount: 1.5 }] }), BUSINESS_A_ID)],
  ["same from/to stop", req("capture.standard_income", standard({ tripLogbook: [{ ...legs[0], toLocation: "noord" }] }), BUSINESS_A_ID)],
  ["empty logbook", req("capture.standard_income", standard({ tripLogbook: [] }), BUSINESS_A_ID)],
  ["time out before time in", req("capture.standard_income", standard({ timeOut: "05:00" }), BUSINESS_A_ID)],
  ["closing odometer not above opening", req("capture.standard_income", standard({ closingOdo: 1000 }), BUSINESS_A_ID)],
  ["zero extra-trip amount", req("capture.special_income", special({ amount: 0 }), BUSINESS_A_ID)],
  ["negative fuel cost", req("capture.special_income", special({ fuelOilCost: -1 }), BUSINESS_A_ID)],
  ["zero expense amount", req("capture.expense", expense({ amount: 0 }), BUSINESS_A_ID)],
  ["non-boolean payment method", req("capture.expense", expense({ cashExpense: "yes" }), BUSINESS_A_ID)],
  ["vehicle on an operational expense", req("capture.expense", expense({ vehicleId: "uat-veh-01" }), BUSINESS_A_ID)],
  ["asset expense without a vehicle", req("capture.expense", expense({ expenseKind: "asset" }), BUSINESS_A_ID)],
  ["bad date", req("capture.expense", expense({ expenseDate: "02/10/2026" }), BUSINESS_A_ID)],
];
for (const [label, body] of invalid) {
  const r = await post(driverA, body);
  record(r.status === 400 && rowState(BUSINESS_A_ID) === stateA, `rejected: ${label}`, `${r.status} ${r.json.error ?? ""}`);
}

// --- Associations and cross-business ------------------------------------------------------
let r = await post(driverA, req("capture.standard_income", standard({ vehicleId: "uat-veh-01-b" }), BUSINESS_A_ID));
record(r.status === 404 && rowState(BUSINESS_A_ID) === stateA, "Business B vehicle id refused in Business A", `${r.status}`);
r = await post(driverA, req("capture.standard_income", standard({ vehicleId: "no-such-vehicle" }), BUSINESS_A_ID));
record(r.status === 404, "unknown vehicle refused", `${r.status}`);
r = await post(driverA, req("capture.standard_income", standard(), BUSINESS_B_ID), { business: BUSINESS_B_ID });
record(r.status === 403 && rowState(BUSINESS_B_ID) === initialBState, "Driver A cannot capture into Business B", `${r.status}`);

// --- Role / mode (denied then authorized) -----------------------------------------------------
r = await post(driverA, req("capture.expense", expense({ captureAs: "management" }), BUSINESS_A_ID));
record(r.status === 403, "Driver cannot capture as management", `${r.status}`);
r = await post(ownerA, req("capture.standard_income", standard({ captureAs: "driver" }), BUSINESS_A_ID));
record(r.status === 403, "Owner without a driver linkage cannot capture driver work", `${r.status}`);
r = await post(adminA, req("capture.standard_income", standard({ captureAs: "driver" }), BUSINESS_A_ID));
record(r.status === 403 && rowState(BUSINESS_A_ID) === stateA, "Admin cannot capture driver work", `${r.status}`);

const driverIncome = req("capture.standard_income", standard(), BUSINESS_A_ID);
r = await post(driverA, driverIncome);
const inc = findRecord(BUSINESS_A_ID, r.json.recordId);
record(
  r.status === 200 && inc?.status === "pending" && inc.driverStaffId === "uat-drv-01" && inc.amountClaimed === 920 && inc.tripCount === 2 && inc.totalPassengers === 21 && inc.createdBy === driverA.userId && inc.createdByRole === "Driver" && inc.actualCashReceived === null && inc.source === "server",
  "Driver A captures its own trip income (920, 2 trips, 21 passengers, pending)",
  `${r.status} ${r.json.recordId} discrepancy=${inc?.discrepancy} expectedOpening=${r.json.expectedOpeningOdo}`,
);
const auditA = snapshotOf(BUSINESS_A_ID).auditTrail[0];
record(auditA.entityId === r.json.recordId && auditA.actorId === driverA.userId && auditA.source === "server", "audit event generated server-side");

r = await post(managerA, req("capture.expense", expense(), BUSINESS_A_ID));
const mgrExp = findRecord(BUSINESS_A_ID, r.json.recordId);
record(r.status === 200 && mgrExp?.status === "verified" && mgrExp.driverStaffId === null && mgrExp.cashExpense === true, "Manager (Money on) captures a management expense: verified, no driver (existing rule)", `${r.status}`);
r = await post(adminA, req("capture.special_income", special(), BUSINESS_A_ID));
const sp = findRecord(BUSINESS_A_ID, r.json.recordId);
record(r.status === 200 && sp?.status === "pending" && sp.businessKm === 30 && sp.amountClaimed === 350 && sp.route === "Depot to Airport", "Admin captures an extra trip: pending, business km 30", `${r.status}`);
r = await post(ownerA, req("capture.expense", expense({ expenseKind: "asset", vehicleId: "uat-veh-02", category: "Repairs", cashExpense: false }), BUSINESS_A_ID));
record(r.status === 200 && findRecord(BUSINESS_A_ID, r.json.recordId)?.vehicle === "UAT-TEST-02", "Owner captures a vehicle cost against a valid vehicle", `${r.status}`);

// --- Owner-driver (Business B) ---------------------------------------------------------------
r = await post(ownerB, req("capture.standard_income", standard({ vehicleId: "uat-veh-02-b", tripDate: "2026-10-04", captureAs: "driver" }), BUSINESS_B_ID));
const od = findRecord(BUSINESS_B_ID, r.json.recordId);
record(r.status === 200 && od?.driverStaffId === "uat-drv-b-owner" && od.createdByRole === "Owner" && od.status === "pending", "Owner-driver captures own driver work through one login", `${r.status} ${r.json.recordId}`);
r = await post(ownerB, req("capture.expense", expense({ expenseDate: "2026-10-04" }), BUSINESS_B_ID));
record(r.status === 200 && findRecord(BUSINESS_B_ID, r.json.recordId)?.status === "verified", "the same Owner can still capture management work", `${r.status}`);
r = await post(driverB, req("capture.standard_income", standard({ vehicleId: "uat-veh-01", tripDate: "2026-10-04" }), BUSINESS_B_ID));
record(r.status === 404, "Driver B cannot use a Business A vehicle id", `${r.status}`);
r = await post(driverB, req("capture.expense", expense({ expenseDate: "2026-10-04" }), BUSINESS_B_ID));
record(r.status === 200 && findRecord(BUSINESS_B_ID, r.json.recordId)?.driverStaffId === "uat-drv-b-01", "Driver B captures its own expense in B (pending)", `${r.status}`);

// --- Counted/verified/banked days are closed to new driver work -------------------------------------
stateA = rowState(BUSINESS_A_ID);
r = await post(adminA, req("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 700 }, BUSINESS_A_ID));
record(r.status === 200, "setup: Admin records the 2026-10-01 hand-in (counted)", `${r.status}`);
stateA = rowState(BUSINESS_A_ID);
r = await post(driverA, req("capture.expense", expense({ expenseDate: "2026-10-01" }), BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "driver work cannot be added to a counted day", `${r.status} ${r.json.error ?? ""}`);
r = await post(driverA, req("capture.standard_income", standard({ tripDate: "2026-10-01" }), BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "driver income cannot be added to a counted day", `${r.status}`);

// --- Stale, retry, log loss ---------------------------------------------------------------------------
const versionBefore = version(BUSINESS_A_ID);
r = await post(driverA, { ...req("capture.expense", expense({ expenseDate: "2026-10-05" }), BUSINESS_A_ID), expectedVersion: "2026-01-01T00:00:00.000000Z" });
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "stale save is refused without writing", `${r.status}`);
const once = req("capture.expense", expense({ expenseDate: "2026-10-05", amount: 33 }), BUSINESS_A_ID);
r = await post(driverA, once);
const onceId = r.json.recordId;
stateA = rowState(BUSINESS_A_ID);
r = await post(driverA, once);
const copies = () => snapshotOf(BUSINESS_A_ID).financeTransactions.filter((t) => t.id === onceId).length;
record(r.status === 200 && r.json.replayed === true && copies() === 1 && rowState(BUSINESS_A_ID) === stateA, "retry returns the original record; still exactly one copy", `${r.status} replayed=${r.json.replayed}`);
guard();
psql(`delete from public.finance_action_requests where business_id = '${BUSINESS_A_ID}' and request_id = '${once.requestId}';`);
r = await post(driverA, once);
record(r.status === 409 && copies() === 1 && rowState(BUSINESS_A_ID) === stateA, "after log loss the retry is refused (stale version / existing id); still one copy", `${r.status} ${r.json.error ?? ""}`);
record(versionBefore !== version(BUSINESS_A_ID), "version advanced only for applied captures");

// --- Unrelated data unchanged -------------------------------------------------------------------------------
const finalA = snapshotOf(BUSINESS_A_ID);
const keys = Object.keys(initialA).filter((k) => !["financeTransactions", "auditTrail", "dailyCashUps"].includes(k));
record(keys.every((k) => stableStringify(finalA[k]) === stableStringify(initialA[k])), "all other Business A keys unchanged (appUsers, vehicles, drivers, deposits, …)", `${keys.length} keys`);
const preexisting = initialA.financeTransactions.map((t) => t.id);
const changedPre = preexisting.filter((id) => stableStringify(finalA.financeTransactions.find((t) => t.id === id)) !== stableStringify(initialA.financeTransactions.find((t) => t.id === id)));
record(stableStringify(changedPre.sort()) === stableStringify(["uat-fin-1", "uat-fin-2"]), "pre-existing records changed only by the hand-in (uat-fin-1, uat-fin-2)", changedPre.join(", "));
record(finalA.vehicles.find((v) => v.id === "uat-veh-01").currentOdometer === initialA.vehicles.find((v) => v.id === "uat-veh-01").currentOdometer, "capture does not rewrite vehicle odometer history (existing behaviour)");

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
