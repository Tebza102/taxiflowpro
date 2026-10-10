#!/usr/bin/env node
// Integration proof of income.count / income.verify (standalone) and
// record.edit / record.delete via POST /api/business/finance-actions against
// the LOCAL synthetic stack with REAL local Auth tokens. Requires a fresh
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
const sql = (t) => psql(t).stdout.trim();
const version = (b) => sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${b}';`);
const snapshotOf = (b) => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${b}';`));
const rowState = (b) => sql(`select md5(snapshot::text) from public.workspace_snapshots where business_id = '${b}';`);
const rec = (b, id) => snapshotOf(b).financeTransactions.find((t) => t.id === id);

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
  { fromLocation: "Noord", toLocation: "Alexandra", passengerCount: 10, amountCollected: 300 },
  { fromLocation: "Alexandra", toLocation: "Noord", passengerCount: 8, amountCollected: 200 },
];
const standardChanges = (o = {}) => ({ vehicleId: "uat-veh-01", tripDate: "2026-10-02", timeIn: "07:00", timeOut: "09:00", openingOdo: 1080, closingOdo: 1120, tripLogbook: legs, ...o });
const expenseFields = (o = {}) => ({ expenseKind: "operational", category: "Fuel", description: "UAT fuel", expenseDate: "2026-10-06", amount: 90, cashExpense: true, ...o });

const ownerA = await tokenFor("owner@example.com");
const adminA = await tokenFor("admin@example.com");
const managerA = await tokenFor("manager@example.com");
const driverA = await tokenFor("driver@example.com");
const ownerB = await tokenFor("owner.b@example.com");
const driverB = await tokenFor("driver.b@example.com");

const initialA = snapshotOf(BUSINESS_A_ID);
const initialB = rowState(BUSINESS_B_ID);
let stateA = rowState(BUSINESS_A_ID);

// --- Standalone count / verify (uat-fin-7: pending extra trip, claimed 300) ---------------
let r = await post(driverA, req("income.count", { recordId: "uat-fin-7", actualCashReceived: 280 }, BUSINESS_A_ID));
record(r.status === 403 && rowState(BUSINESS_A_ID) === stateA, "Driver cannot record a standalone hand-in", `${r.status}`);
r = await post(managerA, req("income.count", { recordId: "uat-fin-7", actualCashReceived: 280 }, BUSINESS_A_ID));
record(r.status === 403 && rowState(BUSINESS_A_ID) === stateA, "Manager cannot record a hand-in (existing rule: Owner/Admin)", `${r.status}`);
r = await post(managerA, req("income.verify", { recordId: "uat-fin-7" }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "verify before hand-in is refused", `${r.status}`);
r = await post(adminA, req("income.count", { recordId: "uat-fin-5", actualCashReceived: 250 }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "driver work cannot be counted record-by-record (day checking only)", `${r.status} ${r.json.error ?? ""}`);
r = await post(adminA, req("income.count", { recordId: "uat-fin-7-b", actualCashReceived: 1 }, BUSINESS_A_ID));
record(r.status === 404 && rowState(BUSINESS_B_ID) === initialB, "a Business B record id is not found in Business A", `${r.status}`);
r = await post(adminA, req("income.count", { recordId: "uat-fin-7-b", actualCashReceived: 1 }, BUSINESS_B_ID), { business: BUSINESS_B_ID });
record(r.status === 403 && rowState(BUSINESS_B_ID) === initialB, "Admin A cannot select Business B", `${r.status}`);
r = await post(adminA, req("income.count", { recordId: "uat-fin-4", actualCashReceived: 1 }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "a banked record cannot be counted", `${r.status}`);
r = await post(adminA, { ...req("income.count", { recordId: "uat-fin-7", actualCashReceived: 280 }, BUSINESS_A_ID), expectedVersion: "2026-01-01T00:00:00.000000Z" });
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "stale count refused", `${r.status}`);
const count = req("income.count", { recordId: "uat-fin-7", actualCashReceived: 280 }, BUSINESS_A_ID);
r = await post(adminA, count);
let fin7 = rec(BUSINESS_A_ID, "uat-fin-7");
record(r.status === 200 && fin7.status === "counted" && fin7.actualCashReceived === 280 && fin7.countedBy === adminA.userId && r.json.variance === -20 && r.json.shortage === 20, "Admin records the hand-in: pending -> counted (variance -20)", `${r.status}`);
stateA = rowState(BUSINESS_A_ID);
r = await post(adminA, count);
record(r.status === 200 && r.json.replayed === true && rowState(BUSINESS_A_ID) === stateA, "retried count is replayed without a second write", `${r.status}`);
r = await post(adminA, req("income.verify", { recordId: "uat-fin-7" }, BUSINESS_A_ID));
record(r.status === 403, "Admin cannot verify (existing rule: Owner/Manager)", `${r.status}`);
r = await post(managerA, req("income.verify", { recordId: "uat-fin-7" }, BUSINESS_A_ID));
fin7 = rec(BUSINESS_A_ID, "uat-fin-7");
record(r.status === 200 && fin7.status === "verified" && fin7.verifiedBy === managerA.userId, "Manager verifies: counted -> verified", `${r.status}`);
stateA = rowState(BUSINESS_A_ID);

// --- Edit ------------------------------------------------------------------------------------
r = await post(driverA, req("record.edit", { recordId: "uat-fin-5", changes: standardChanges() }, BUSINESS_A_ID));
record(r.status === 400 && rowState(BUSINESS_A_ID) === stateA, "a driver edit without a reason is refused", `${r.status} ${r.json.error ?? ""}`);
r = await post(driverA, req("record.edit", { recordId: "uat-fin-5", editReason: "x", changes: { ...standardChanges(), status: "verified" } }, BUSINESS_A_ID));
record(r.status === 400 && rowState(BUSINESS_A_ID) === stateA, "a forged status in the changes is refused", `${r.status}`);
r = await post(driverA, req("record.edit", { recordId: "uat-fin-5", editReason: "x", changes: { ...standardChanges(), captureAs: "management" } }, BUSINESS_A_ID));
record(r.status === 400 && rowState(BUSINESS_A_ID) === stateA, "captureAs cannot be changed on an edit", `${r.status}`);
r = await post(driverA, req("record.edit", { recordId: "uat-fin-7", editReason: "x", changes: { vehicleId: "uat-veh-02", tripDate: "2026-10-01", openingOdo: 1, closingOdo: 2, fromLocation: "a", toLocation: "b", travelReason: "c", amount: 1 } }, BUSINESS_A_ID));
record(r.status === 403 || r.status === 409, "a driver cannot edit someone else's / verified record", `${r.status}`);
r = await post(driverA, req("record.edit", { recordId: "uat-fin-4", editReason: "x", changes: standardChanges() }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "a banked record cannot be edited", `${r.status}`);
r = await post(driverA, req("record.edit", { recordId: "uat-fin-5", editReason: "move day", changes: standardChanges({ tripDate: "2026-10-01" }) }, BUSINESS_A_ID));
r = await post(adminA, req("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 700 }, BUSINESS_A_ID));
record(r.status === 200, "setup: 2026-10-01 day checking counted", `${r.status}`);
stateA = rowState(BUSINESS_A_ID);
const fin5Before = rec(BUSINESS_A_ID, "uat-fin-5");
const dateForMove = fin5Before.tripDate === "2026-10-01" ? "2026-10-02" : "2026-10-01";
r = await post(driverA, req("record.edit", { recordId: "uat-fin-5", editReason: "move day", changes: standardChanges({ tripDate: dateForMove }) }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "an edit that touches a counted day is refused (closed-day guard)", `${r.status} ${r.json.error ?? ""}`);
r = await post(driverA, req("record.edit", { recordId: "uat-fin-1", editReason: "x", changes: standardChanges({ tripDate: "2026-10-01" }) }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "a counted record cannot be edited", `${r.status}`);
// A pending record on an open day: capture one, then edit it.
r = await post(driverA, req("capture.standard_income", standardChanges({ tripDate: "2026-10-06", openingOdo: 2000, closingOdo: 2050 }), BUSINESS_A_ID));
const capturedId = r.json.recordId;
const captured = rec(BUSINESS_A_ID, capturedId);
r = await post(driverA, req("record.edit", { recordId: capturedId, editReason: "second leg was 250", changes: standardChanges({ tripDate: "2026-10-06", openingOdo: 2000, closingOdo: 2050, tripLogbook: [legs[0], { ...legs[1], amountCollected: 250 }] }) }, BUSINESS_A_ID));
const edited = rec(BUSINESS_A_ID, capturedId);
record(
  r.status === 200 && edited.amountClaimed === 550 && edited.status === "pending" && edited.driverStaffId === "uat-drv-01" && edited.createdBy === captured.createdBy && edited.editHistory.length === 1 && edited.lastEditReason === "second leg was 250" && edited.updatedBy === driverA.userId,
  "Driver edits its own pending record: amount 550, history kept, creator and ownership preserved",
  `${r.status} ${r.json.summary ?? ""}`,
);
r = await post(managerA, req("record.edit", { recordId: capturedId, changes: standardChanges({ tripDate: "2026-10-06", openingOdo: 2000, closingOdo: 2050 }) }, BUSINESS_A_ID));
const mgrEdited = rec(BUSINESS_A_ID, capturedId);
record(r.status === 200 && mgrEdited.driverStaffId === "uat-drv-01" && mgrEdited.status === "pending" && mgrEdited.editHistory.length === 1, "Manager (finance edit) edits a pending driver record: ownership kept, stays pending, no reason required", `${r.status}`);
r = await post(driverB, req("record.edit", { recordId: capturedId, editReason: "x", changes: standardChanges() }, BUSINESS_B_ID));
record(r.status === 404 && rowState(BUSINESS_B_ID) === initialB, "Driver B cannot reach a Business A record", `${r.status}`);

// --- Owner-driver (Business B) ----------------------------------------------------------------
r = await post(ownerB, req("capture.expense", expenseFields({ captureAs: "driver", expenseDate: "2026-10-07" }), BUSINESS_B_ID));
const odId = r.json.recordId;
r = await post(ownerB, req("record.edit", { recordId: odId, editReason: "receipt said 95", changes: expenseFields({ expenseDate: "2026-10-07", amount: 95 }) }, BUSINESS_B_ID));
const odRec = rec(BUSINESS_B_ID, odId);
record(r.status === 200 && odRec.amount === 95 && odRec.driverStaffId === "uat-drv-b-owner" && odRec.editHistory.length === 1 && odRec.status === "pending", "Owner-driver edits its own driver expense (linkage preserved, history recorded)", `${r.status}`);
r = await post(ownerB, req("record.delete", { recordId: odId, reason: "duplicate" }, BUSINESS_B_ID));
record(r.status === 200 && !rec(BUSINESS_B_ID, odId), "Owner-driver (Owner role) can delete that pending record", `${r.status}`);

// --- Delete -------------------------------------------------------------------------------------
stateA = rowState(BUSINESS_A_ID);
r = await post(driverA, req("record.delete", { recordId: capturedId }, BUSINESS_A_ID));
record(r.status === 403 && rowState(BUSINESS_A_ID) === stateA, "Driver cannot delete (existing rule: finance edit)", `${r.status}`);
r = await post(managerA, req("record.delete", { recordId: "uat-fin-7" }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "a verified record cannot be deleted", `${r.status}`);
r = await post(managerA, req("record.delete", { recordId: "uat-fin-4" }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "a banked record cannot be deleted", `${r.status}`);
r = await post(managerA, req("record.delete", { recordId: "uat-fin-2" }, BUSINESS_A_ID));
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "a record inside a counted day cannot be deleted", `${r.status}`);
r = await post(managerA, req("record.delete", { recordId: "uat-fin-7-b" }, BUSINESS_A_ID));
record(r.status === 404 && rowState(BUSINESS_B_ID) !== "" , "a Business B record id cannot be deleted from A", `${r.status}`);
r = await post(managerA, { ...req("record.delete", { recordId: capturedId }, BUSINESS_A_ID), expectedVersion: "2026-01-01T00:00:00.000000Z" });
record(r.status === 409 && rowState(BUSINESS_A_ID) === stateA, "stale delete refused", `${r.status}`);
const del = req("record.delete", { recordId: capturedId, reason: "UAT cleanup" }, BUSINESS_A_ID);
r = await post(managerA, del);
record(r.status === 200 && !rec(BUSINESS_A_ID, capturedId) && snapshotOf(BUSINESS_A_ID).auditTrail[0].action === "delete", "Manager deletes the pending record with a server audit entry", `${r.status}`);
stateA = rowState(BUSINESS_A_ID);
r = await post(managerA, del);
record(r.status === 200 && r.json.replayed === true && rowState(BUSINESS_A_ID) === stateA, "retried delete is replayed", `${r.status}`);
guard();
psql(`delete from public.finance_action_requests where business_id = '${BUSINESS_A_ID}' and request_id = '${del.requestId}';`);
r = await post(managerA, del);
record([404, 409].includes(r.status) && rowState(BUSINESS_A_ID) === stateA, "after log loss the retried delete is refused (record already gone or stale), nothing changes", `${r.status} ${r.json.error ?? ""}`);

// --- Unrelated data ------------------------------------------------------------------------------
const finalA = snapshotOf(BUSINESS_A_ID);
const keys = Object.keys(initialA).filter((k) => !["financeTransactions", "auditTrail", "dailyCashUps"].includes(k));
record(keys.every((k) => stableStringify(finalA[k]) === stableStringify(initialA[k])), "all other Business A keys unchanged", `${keys.length} keys`);
const changed = initialA.financeTransactions.map((t) => t.id).filter((id) => stableStringify(finalA.financeTransactions.find((t) => t.id === id)) !== stableStringify(initialA.financeTransactions.find((t) => t.id === id)));
record(stableStringify(changed.sort()) === stableStringify(["uat-fin-1", "uat-fin-2", "uat-fin-5", "uat-fin-7"].filter((id) => changed.includes(id)).sort()) && !changed.some((id) => ["uat-fin-3", "uat-fin-4", "uat-fin-6"].includes(id)), "untouched records (uat-fin-3, -4, -6) unchanged", changed.join(", "));

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
