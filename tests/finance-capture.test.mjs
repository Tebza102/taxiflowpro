import assert from "node:assert/strict";
import test from "node:test";

import { applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { buildBusinessBSnapshot, buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Pure capture rules (no network). Behavioural proof against the local database:
// scripts/localdb/finance-capture-tests.mjs.
const RID = "22222222-2222-4222-8222-222222222222";
const parse = (action, fields) => parseFinanceActionRequest({ action, requestId: RID, expectedVersion: "2026-10-01T16:30:00Z", fields });
const expense = (extra = {}) => parse("capture.expense", { expenseKind: "operational", category: "Fuel", description: "x", expenseDate: "2026-10-02", amount: 50, cashExpense: true, ...extra });

test("management capture needs finance edit: Money-off Manager/Admin refused, Owner always allowed", () => {
  const stored = buildSyntheticSnapshot();
  for (const role of ["Manager", "Admin"]) {
    assert.throws(() => applyFinanceAction(stored, expense(), { id: "u", role, moduleAccess: { finance: false } }), (e) => e.statusCode === 403 && /Money access/.test(e.message));
    assert.equal(applyFinanceAction(stored, expense(), { id: "u", role, moduleAccess: { finance: true } }).response.status, "verified");
  }
  assert.equal(applyFinanceAction(stored, expense(), { id: "u", role: "Owner" }).response.status, "verified");
});

test("driver capture: own linkage required, pending status, driver record must exist in the business", () => {
  const stored = buildSyntheticSnapshot();
  assert.throws(() => applyFinanceAction(stored, expense(), { id: "d", role: "Driver" }), (e) => e.statusCode === 403);
  const ok = applyFinanceAction(stored, expense(), { id: "d", role: "Driver", driverStaffId: "uat-drv-01" });
  assert.deepEqual([ok.response.status, ok.response.driverStaffId], ["pending", "uat-drv-01"]);
  assert.throws(() => applyFinanceAction(stored, expense(), { id: "d", role: "Driver", driverStaffId: "uat-drv-b-01" }), (e) => e.statusCode === 409 && /does not exist in this business/.test(e.message));
});

test("owner-driver: captureAs driver uses the membership linkage; without a linkage it is refused", () => {
  const stored = buildBusinessBSnapshot();
  const ownerDriver = applyFinanceAction(stored, expense({ captureAs: "driver", expenseDate: "2026-10-04" }), { id: "o", role: "Owner", driverStaffId: "uat-drv-b-owner" });
  assert.deepEqual([ownerDriver.response.status, ownerDriver.response.driverStaffId], ["pending", "uat-drv-b-owner"]);
  assert.throws(() => applyFinanceAction(stored, expense({ captureAs: "driver" }), { id: "o", role: "Owner" }), (e) => e.statusCode === 403);
});

test("record ids derive from the request id, so a retried capture cannot create a duplicate", () => {
  const stored = buildSyntheticSnapshot();
  const requester = { id: "u", role: "Owner" };
  const first = applyFinanceAction(stored, expense(), requester);
  assert.equal(first.response.recordId, `txn-exp-${RID}`);
  assert.throws(() => applyFinanceAction(first.snapshot, expense(), requester), (e) => e.statusCode === 409 && /already saved/.test(e.message));
});
