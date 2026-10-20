import assert from "node:assert/strict";
import test from "node:test";

import { applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Pure rules for standalone count/verify and edit/delete (no network).
// Behavioural proof: scripts/localdb/finance-record-tests.mjs.
const parse = (action, fields) => parseFinanceActionRequest({ action, requestId: "44444444-4444-4444-8444-444444444444", expectedVersion: "2026-10-01T00:00:00Z", fields });
const owner = { id: "o", role: "Owner" };
const admin = { id: "a", role: "Admin", permissions: ["cash.count"] };
const manager = { id: "m", role: "Manager", moduleAccess: { finance: true }, permissions: ["cash.bank", "cash.verify"] };
const driver = { id: "d", role: "Driver", driverStaffId: "uat-drv-01" };
const changes = (o = {}) => ({ vehicleId: "uat-veh-01", tripDate: "2026-10-02", timeIn: "07:00", timeOut: "09:00", openingOdo: 1080, closingOdo: 1120, tripLogbook: [{ fromLocation: "A", toLocation: "B", passengerCount: 3, amountCollected: 90 }], ...o });

test("edit changes accept only the capture field list (regression: forged status/computed fields refused)", () => {
  const stored = buildSyntheticSnapshot();
  for (const forged of [{ status: "verified" }, { amountClaimed: 1 }, { discrepancy: false }, { driverStaffId: "x" }, { createdBy: "x" }]) {
    assert.throws(() => applyFinanceAction(stored, parse("record.edit", { recordId: "uat-fin-5", editReason: "r", changes: changes(forged) }), driver), (e) => e.statusCode === 400, JSON.stringify(forged));
  }
});

test("standalone count/verify: roles, driver work excluded, transitions, variance", () => {
  const stored = buildSyntheticSnapshot();
  assert.throws(() => applyFinanceAction(stored, parse("income.count", { recordId: "uat-fin-7", actualCashReceived: 280 }), manager), (e) => e.statusCode === 403);
  assert.throws(() => applyFinanceAction(stored, parse("income.count", { recordId: "uat-fin-5", actualCashReceived: 1 }), admin), (e) => e.statusCode === 409);
  const counted = applyFinanceAction(stored, parse("income.count", { recordId: "uat-fin-7", actualCashReceived: 280 }), admin);
  assert.deepEqual([counted.response.status, counted.response.variance, counted.response.shortage], ["counted", -20, 20]);
  assert.throws(() => applyFinanceAction(counted.snapshot, parse("income.verify", { recordId: "uat-fin-7" }), admin), (e) => e.statusCode === 403);
  assert.equal(applyFinanceAction(counted.snapshot, parse("income.verify", { recordId: "uat-fin-7" }), owner).response.status, "verified");
});

test("edit: pending only, driver owns + reason, ownership/creator preserved, stays pending", () => {
  const stored = buildSyntheticSnapshot();
  assert.throws(() => applyFinanceAction(stored, parse("record.edit", { recordId: "uat-fin-5", changes: changes() }), driver), (e) => e.statusCode === 400);
  assert.throws(() => applyFinanceAction(stored, parse("record.edit", { recordId: "uat-fin-5", editReason: "r", changes: changes() }), { ...driver, driverStaffId: "other" }), (e) => e.statusCode === 403);
  assert.throws(() => applyFinanceAction(stored, parse("record.edit", { recordId: "uat-fin-6", editReason: "r", changes: changes() }), manager), (e) => e.statusCode === 409);
  const edited = applyFinanceAction(stored, parse("record.edit", { recordId: "uat-fin-5", editReason: "fix", changes: changes() }), driver);
  const record = edited.snapshot.financeTransactions.find((t) => t.id === "uat-fin-5");
  assert.deepEqual([record.status, record.driverStaffId, record.amountClaimed, record.editHistory.length, record.lastEditedBy], ["pending", "uat-drv-01", 90, 1, "d"]);
});

test("delete: finance edit only, pending only, never banked", () => {
  const stored = buildSyntheticSnapshot();
  assert.throws(() => applyFinanceAction(stored, parse("record.delete", { recordId: "uat-fin-5" }), driver), (e) => e.statusCode === 403);
  assert.throws(() => applyFinanceAction(stored, parse("record.delete", { recordId: "uat-fin-4" }), owner), (e) => e.statusCode === 409);
  assert.throws(() => applyFinanceAction(stored, parse("record.delete", { recordId: "uat-fin-3" }), owner), (e) => e.statusCode === 409);
  assert.equal(applyFinanceAction(stored, parse("record.delete", { recordId: "uat-fin-5" }), manager).response.deleted, true);
});
