import assert from "node:assert/strict";
import test from "node:test";

import { FINANCE_ACTIONS, applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Pure rules of the scoped finance write path (no network). The behavioural
// proof against the local database is scripts/localdb/finance-action-tests.mjs.

const RID = "11111111-1111-4111-8111-111111111111";
const envelope = (action, fields, extra = {}) => ({ action, requestId: RID, expectedVersion: "2026-10-01T16:30:00Z", fields, ...extra });
const parse = (...args) => parseFinanceActionRequest(envelope(...args));
const admin = { id: "u-admin", role: "Admin" };
const manager = { id: "u-manager", role: "Manager" };
const owner = { id: "u-owner", role: "Owner" };
const driver = { id: "u-driver", role: "Driver", driverStaffId: "uat-drv-01" };

test("supported actions and roles match the existing workflow plus the approved owner-driver rule", () => {
  // Owner-driver (Task 14, approved): an Owner with a membership driver linkage
  // may submit their own day checking; the linkage is still required.
  assert.deepEqual(FINANCE_ACTIONS["cashup.submit"].roles, ["Driver", "Owner"]);
  assert.equal(FINANCE_ACTIONS["cashup.submit"].requiresDriverLink, true);
  assert.deepEqual(FINANCE_ACTIONS["cashup.record_handin"].roles, ["Owner", "Admin"]);
  assert.deepEqual(FINANCE_ACTIONS["cashup.verify"].roles, ["Owner", "Manager"]);
  assert.deepEqual(FINANCE_ACTIONS["deposit.lock"].roles, ["Owner", "Manager"]);
  assert.equal(FINANCE_ACTIONS["deposit.lock"].requiresFinanceEdit, true);
});

test("request parsing rejects snapshots, membership/business/role fields and unknown actions", () => {
  assert.throws(() => parseFinanceActionRequest(envelope("cashup.verify", { cashUpId: "x" }, { snapshot: {} })), /Unsupported request fields: snapshot/);
  assert.throws(() => parseFinanceActionRequest(envelope("cashup.verify", { cashUpId: "x" }, { businessId: "b" })), /Unsupported request fields/);
  assert.throws(() => parse("cashup.verify", { cashUpId: "x", role: "Owner" }), /Unsupported fields/);
  assert.throws(() => parse("cashup.verify", { cashUpId: "x", appUsers: [] }), /Unsupported fields/);
  assert.throws(() => parse("membership.set", {}), /Unsupported finance action/);
  assert.throws(() => parse("snapshot.replace", {}), /Unsupported finance action/);
  assert.throws(() => parseFinanceActionRequest(envelope("cashup.verify", { cashUpId: "x" }, { requestId: "nope" })), /requestId/);
  assert.throws(() => parseFinanceActionRequest({ action: "cashup.verify", requestId: RID, fields: { cashUpId: "x" } }), /expectedVersion/);
  assert.throws(() => parse("cashup.record_handin", { cashUpId: "x", actualCashReceived: -1 }), /non-negative/);
  assert.throws(() => parse("cashup.submit", { workDate: "01/10/2026" }), /YYYY-MM-DD/);
  assert.equal(parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680.004 }).fields.actualCashReceived, 680);
});

test("the request hash identifies the request content for retry protection", () => {
  const a = parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 });
  const b = parse("cashup.record_handin", { actualCashReceived: 680, cashUpId: "uat-cu-1" });
  const c = parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 681 });
  assert.equal(a.requestHash, b.requestHash);
  assert.notEqual(a.requestHash, c.requestHash);
});

test("hand-in: Owner/Admin only, pending -> counted, expected/actual/variance preserved, server actor + audit", () => {
  const stored = buildSyntheticSnapshot();
  const request = parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 });
  for (const requester of [manager, driver]) {
    assert.throws(() => applyFinanceAction(stored, request, requester), (e) => e.statusCode === 403);
  }
  const { snapshot, response } = applyFinanceAction(stored, request, admin, "2026-10-01T19:00:00Z");
  assert.deepEqual([response.status, response.expectedCashIn, response.actualCashReceived, response.variance, response.shortage], ["counted", 700, 680, -20, 20]);
  const cashUp = snapshot.dailyCashUps.find((c) => c.id === "uat-cu-1");
  assert.deepEqual([cashUp.status, cashUp.countedBy, cashUp.countedByRole], ["counted", "u-admin", "Admin"]);
  assert.deepEqual(snapshot.financeTransactions.filter((r) => ["uat-fin-1", "uat-fin-2"].includes(r.id)).map((r) => r.status), ["counted", "counted"]);
  assert.equal(snapshot.auditTrail[0].actorId, "u-admin");
  assert.equal(snapshot.auditTrail[0].source, "server");
  // Unrelated data is untouched.
  for (const key of ["appUsers", "vehicles", "drivers", "deposits", "profile", "routes"]) assert.deepEqual(snapshot[key], stored[key], key);
  assert.deepEqual(snapshot.financeTransactions.filter((r) => !["uat-fin-1", "uat-fin-2"].includes(r.id)), stored.financeTransactions.filter((r) => !["uat-fin-1", "uat-fin-2"].includes(r.id)));
});

test("verify: Owner/Manager only, only from counted; invalid transitions are refused", () => {
  const stored = buildSyntheticSnapshot();
  const verify = parse("cashup.verify", { cashUpId: "uat-cu-1" });
  assert.throws(() => applyFinanceAction(stored, verify, manager), (e) => e.statusCode === 409 && /hand-in/.test(e.message));
  const counted = applyFinanceAction(stored, parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 700 }), owner).snapshot;
  assert.throws(() => applyFinanceAction(counted, verify, admin), (e) => e.statusCode === 403);
  assert.throws(() => applyFinanceAction(counted, parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 1 }), admin), (e) => e.statusCode === 409);
  const verified = applyFinanceAction(counted, verify, manager);
  assert.equal(verified.response.status, "verified");
  assert.throws(() => applyFinanceAction(verified.snapshot, verify, manager), (e) => e.statusCode === 409 && /already been verified/.test(e.message));
});

test("banked records cannot change; unknown cash-up ids are 404", () => {
  const stored = buildSyntheticSnapshot();
  stored.financeTransactions = stored.financeTransactions.map((r) => (["uat-fin-1", "uat-fin-2"].includes(r.id) ? { ...r, status: "banked" } : r));
  assert.throws(() => applyFinanceAction(stored, parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 1 }), admin), (e) => e.statusCode === 409 && /Deposited/.test(e.message));
  assert.throws(() => applyFinanceAction(buildSyntheticSnapshot(), parse("cashup.verify", { cashUpId: "uat-cu-1-b" }), manager), (e) => e.statusCode === 404);
});

test("submit: Driver, or Owner with a driver linkage; staff id from the membership, own records only", () => {
  const stored = buildSyntheticSnapshot();
  const request = parse("cashup.submit", { workDate: "2026-10-02" });
  for (const requester of [owner, admin, manager]) assert.throws(() => applyFinanceAction(stored, request, requester), (e) => e.statusCode === 403);
  // Owner who drives: same identity, Owner role kept; acts only on own linked records.
  const ownerDriver = applyFinanceAction(stored, request, { ...owner, driverStaffId: "uat-drv-01" });
  assert.equal(ownerDriver.response.expectedCashIn, 250);
  assert.equal(ownerDriver.snapshot.dailyCashUps.find((c) => c.id === ownerDriver.response.cashUpId).checkedByRole, "Owner");
  assert.throws(() => applyFinanceAction(stored, request, { ...owner, driverStaffId: "someone-else" }), (e) => e.statusCode === 409, "no records of its own that day");
  assert.throws(() => applyFinanceAction(stored, request, { ...driver, driverStaffId: null }), /not linked/);
  const { snapshot, response } = applyFinanceAction(stored, request, driver);
  assert.equal(response.expectedCashIn, 250);
  const created = snapshot.dailyCashUps.find((c) => c.id === response.cashUpId);
  assert.deepEqual([created.driverStaffId, created.status, created.checkedBy], ["uat-drv-01", "pending", "u-driver"]);
  assert.throws(() => applyFinanceAction(stored, parse("cashup.submit", { workDate: "2026-10-03" }), driver), (e) => e.statusCode === 409);
});

const verifiedBatch = () => {
  let stored = buildSyntheticSnapshot();
  stored = applyFinanceAction(stored, parse("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }), admin).snapshot;
  return applyFinanceAction(stored, parse("cashup.verify", { cashUpId: "uat-cu-1" }), manager).snapshot;
};
const lock = (cashUpIds, transactionIds) => parse("deposit.lock", { cashUpIds, transactionIds });
const moneyManager = { ...manager, moduleAccess: { finance: true } };

test("deposit.lock: Owner/Manager with finance edit; Admin, Driver and Money-off Manager refused", () => {
  const stored = verifiedBatch();
  const request = lock(["uat-cu-1"], ["uat-fin-1", "uat-fin-2", "uat-fin-3"]);
  for (const requester of [admin, driver, { ...manager, moduleAccess: { finance: false } }]) {
    assert.throws(() => applyFinanceAction(stored, request, requester), (e) => e.statusCode === 403);
  }
  const { snapshot, response } = applyFinanceAction(stored, request, moneyManager, "2026-10-01T20:00:00Z");
  assert.deepEqual([response.recordsLocked, response.depositAmount, response.verifiedTakings], [2, 880, 900]);
  const deposit = snapshot.deposits[0];
  assert.deepEqual([deposit.depositId, deposit.lockedBy, deposit.lockedByRole, deposit.source], [response.depositId, "u-manager", "Manager", "server"]);
  assert.ok(["uat-fin-1", "uat-fin-2", "uat-fin-3"].every((id) => snapshot.financeTransactions.find((r) => r.id === id).status === "banked"));
  assert.equal(snapshot.dailyCashUps.find((c) => c.id === "uat-cu-1").status, "banked");
  assert.equal(snapshot.financeTransactions.find((r) => r.id === "uat-fin-6").status, "counted", "unverified record untouched");
  assert.ok(applyFinanceAction(stored, request, owner).response.depositId, "Owner may also bank");
});

test("deposit.lock: foreign ids 404, unverified or mismatched batches 409, nothing banked twice", () => {
  const stored = verifiedBatch();
  assert.throws(() => applyFinanceAction(stored, lock(["uat-cu-1"], ["uat-fin-1", "uat-fin-2", "uat-fin-3", "uat-fin-3-b"]), moneyManager), (e) => e.statusCode === 404);
  assert.throws(() => applyFinanceAction(stored, lock(["uat-cu-1"], ["uat-fin-1", "uat-fin-2", "uat-fin-3", "uat-fin-6"]), moneyManager), (e) => e.statusCode === 409 && /not verified/.test(e.message));
  assert.throws(() => applyFinanceAction(stored, lock(["uat-cu-1"], ["uat-fin-1", "uat-fin-2"]), moneyManager), (e) => e.statusCode === 409 && /changed/.test(e.message));
  // With the day cash-up not yet verified, the only verified item is the standalone record.
  const standaloneOnly = applyFinanceAction(buildSyntheticSnapshot(), lock([], ["uat-fin-3"]), moneyManager).response;
  assert.deepEqual([standaloneOnly.recordsLocked, standaloneOnly.depositAmount], [1, 200]);
  const banked = applyFinanceAction(stored, lock(["uat-cu-1"], ["uat-fin-1", "uat-fin-2", "uat-fin-3"]), moneyManager).snapshot;
  assert.throws(() => applyFinanceAction(banked, lock(["uat-cu-1"], ["uat-fin-1", "uat-fin-2", "uat-fin-3"]), moneyManager), (e) => e.statusCode === 409);
  assert.throws(() => applyFinanceAction(banked, parse("cashup.verify", { cashUpId: "uat-cu-1" }), moneyManager), (e) => e.statusCode === 409 && /Deposited/.test(e.message));
  assert.throws(() => applyFinanceAction(banked, parse("cashup.submit", { workDate: "2026-10-01" }), driver), (e) => e.statusCode === 409 && /Deposited/.test(e.message));
});
