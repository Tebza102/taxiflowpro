import assert from "node:assert/strict";
import test from "node:test";

import { FINANCE_ACTIONS, applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { WORKSPACE_SCOPES, projectWorkspace } from "../api/_lib/scopedWorkspace.js";
import { summarizeDriverDayCash } from "../src/lib/cashUpContract.js";
import { buildPeriodReport, periodReportCsv } from "../src/lib/periodReport.js";
import {
  describeRecurringExpense,
  findRecurringExpense,
  getRecurringExpenses,
  listRecurringOccurrences,
  recurringPaymentRecordId,
} from "../src/lib/recurringExpenseContract.js";
import { getSalaryArrangements } from "../src/lib/salaryContract.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Recurring fixed expenses (src/lib/recurringExpenseContract.js and the server
// actions in api/_lib/recurringActions.js).

const NOW = "2026-10-28T08:00:00.000Z";
const owner = { id: "u-owner", role: "Owner" };
const managerWithMoney = { id: "u-m", role: "Manager", permissions: ["cash.verify"], moduleAccess: { finance: true } };
const managerNoMoney = { id: "u-m2", role: "Manager", permissions: ["drivers.manage"], moduleAccess: { finance: false } };
const driver = { id: "u-d", role: "Driver", driverStaffId: "uat-drv-01" };

let rid = 0;
const request = (action, fields, expectedVersion = "2026-10-01T16:30:00Z") =>
  parseFinanceActionRequest({ action, requestId: `33333333-3333-4333-8333-${String(++rid).padStart(12, "0")}`, expectedVersion, fields });
const act = (snapshot, action, fields, requester = owner, now = NOW) => applyFinanceAction(snapshot, request(action, fields), requester, now);

const RENT = { description: "Depot rent", category: "Rent", amount: 3000, frequency: "monthly", startDate: "2026-01-31", payMethod: "bank" };
const withSchedule = (fields = RENT, snapshot = buildSyntheticSnapshot()) => {
  const result = act(snapshot, "recurring.schedule_save", fields);
  return { snapshot: result.snapshot, id: result.response.scheduleId };
};
const due = (snapshot, id, until) => listRecurringOccurrences(snapshot, findRecurringExpense(snapshot, id), until).occurrences;
const pay = (snapshot, id, period, extra = {}, requester = owner) =>
  act(snapshot, "recurring.payment_record", { scheduleId: id, period, paidDate: "2026-10-28", amount: 3000, method: "bank", source: "business_bank", ...extra }, requester);

test("recurrence: month-end, weekly weekday, fortnightly blocks, daily; first due date is the start date", () => {
  const { snapshot, id } = withSchedule();
  assert.deepEqual(due(snapshot, id, "2026-06-30").map((o) => o.dueDate), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  const leap = withSchedule({ ...RENT, startDate: "2028-01-30" });
  assert.equal(due(leap.snapshot, leap.id, "2028-02-29")[1].dueDate, "2028-02-29");
  const weekly = withSchedule({ ...RENT, frequency: "weekly", startDate: "2026-10-29" }); // Thursday
  assert.deepEqual(due(weekly.snapshot, weekly.id, "2026-11-19").map((o) => [o.period, o.dueDate]), [
    ["2026-10-26", "2026-10-29"], ["2026-11-02", "2026-11-05"], ["2026-11-09", "2026-11-12"], ["2026-11-16", "2026-11-19"],
  ]);
  const fortnightly = withSchedule({ ...RENT, frequency: "fortnightly", startDate: "2026-12-30" }); // year end
  assert.deepEqual(due(fortnightly.snapshot, fortnightly.id, "2027-01-27").map((o) => o.dueDate), ["2026-12-30", "2027-01-13", "2027-01-27"]);
  const daily = withSchedule({ ...RENT, frequency: "daily", startDate: "2026-10-30", endDate: "2026-11-01" });
  assert.deepEqual(due(daily.snapshot, daily.id, "2026-12-31").map((o) => o.dueDate), ["2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.throws(() => act(buildSyntheticSnapshot(), "recurring.schedule_save", { ...RENT, endDate: "2026-01-01" }), /end date cannot be before/);
});

test("missed periods are overdue, today's is due, the next is upcoming; nothing is recorded by looking", () => {
  const { snapshot, id } = withSchedule({ ...RENT, startDate: "2026-07-28" });
  const state = describeRecurringExpense(snapshot, findRecurringExpense(snapshot, id), "2026-10-28");
  assert.deepEqual(state.overdue.map((o) => o.dueDate), ["2026-07-28", "2026-08-28", "2026-09-28"]);
  assert.deepEqual(state.outstanding.filter((o) => o.status === "due").map((o) => o.dueDate), ["2026-10-28"]);
  assert.equal(state.outstandingAmount, 12000);
  assert.equal(state.nextDue.dueDate, "2026-11-28");
  assert.deepEqual(snapshot.financeTransactions, buildSyntheticSnapshot().financeTransactions, "a schedule adds no expense");
});

test("record payment: one expense with the occurrence's details; duplicates refused; history and original amount kept", () => {
  let { snapshot, id } = withSchedule({ ...RENT, startDate: "2026-09-30", vehicleId: "uat-veh-01" });
  const paid = pay(snapshot, id, "2026-09", { amount: 2950, reference: "EFT 1" });
  snapshot = paid.snapshot;
  const record = snapshot.financeTransactions[0];
  assert.equal(record.id, recurringPaymentRecordId(id, "2026-09"));
  assert.deepEqual(
    { category: record.category, vehicle: record.vehicle, vehicleId: record.vehicleId, amount: record.amount, cash: record.cashExpense, status: record.status, driver: record.driverStaffId },
    { category: "Rent", vehicle: "UAT-TEST-01", vehicleId: "uat-veh-01", amount: 2950, cash: false, status: "verified", driver: null },
  );
  assert.equal(record.recurringPayment.scheduledAmount, 3000);
  assert.equal(record.recurringPayment.dueDate, "2026-09-30");
  // Same occurrence again (a refresh, a retry with a new request id, another device): refused.
  assert.throws(() => pay(snapshot, id, "2026-09"), (e) => e.statusCode === 409 && /already recorded/.test(e.message));
  // Not an occurrence: before the start, or a malformed period.
  assert.throws(() => pay(snapshot, id, "2026-08"), (e) => e.statusCode === 400);
  assert.throws(() => pay(snapshot, id, "2026-13"), (e) => e.statusCode === 400);
  // Change the amount from November: September keeps 2950 paid / 3000 scheduled; October still 3000.
  snapshot = act(snapshot, "recurring.schedule_save", { ...RENT, startDate: "2026-09-30", vehicleId: "uat-veh-01", scheduleId: id, amount: 3300, effectiveFrom: "2026-11-01", revision: 1 }).snapshot;
  const occurrences = due(snapshot, id, "2026-11-30");
  assert.deepEqual(occurrences.map((o) => [o.period, o.amount]), [["2026-09", 3000], ["2026-10", 3000], ["2026-11", 3300]]);
  assert.equal(snapshot.financeTransactions.find((r) => r.id === record.id).amount, 2950);
  // Edits apply to occurrences, never to recorded payments.
  assert.throws(() => act(snapshot, "record.edit", { recordId: record.id, amount: 1 }), (e) => [400, 409].includes(e.statusCode));
});

test("edits: revision guard against silent overwrite; history cannot be rewritten; frequency and start are fixed", () => {
  let { snapshot, id } = withSchedule();
  const base = { ...RENT, scheduleId: id };
  assert.throws(() => act(snapshot, "recurring.schedule_save", { ...base, amount: 1 }), (e) => e.statusCode === 409 && /Open it/.test(e.message));
  snapshot = act(snapshot, "recurring.schedule_save", { ...base, amount: 3100, effectiveFrom: "2026-06-01", revision: 1 }).snapshot;
  assert.throws(() => act(snapshot, "recurring.schedule_save", { ...base, amount: 3200, revision: 1 }), (e) => e.statusCode === 409 && /changed by someone else/.test(e.message));
  assert.throws(() => act(snapshot, "recurring.schedule_save", { ...base, amount: 3200, effectiveFrom: "2026-05-01", revision: 2 }), /cannot apply before the last change \(2026-06-01\)/);
  assert.throws(() => act(snapshot, "recurring.schedule_save", { ...base, frequency: "weekly", revision: 2 }), /cannot change/);
  assert.equal(findRecurringExpense(snapshot, id).versions.length, 2);
});

test("pause, resume and stop: paused dates are not due; stopping keeps payments, history and audit", () => {
  let { snapshot, id } = withSchedule({ ...RENT, startDate: "2026-01-15" });
  snapshot = pay(snapshot, id, "2026-01").snapshot;
  snapshot = act(snapshot, "recurring.schedule_status", { scheduleId: id, change: "pause", date: "2026-03-01", revision: 1 }).snapshot;
  assert.throws(() => act(snapshot, "recurring.schedule_status", { scheduleId: id, change: "pause", date: "2026-03-02", revision: 2 }), /only an active one/);
  snapshot = act(snapshot, "recurring.schedule_status", { scheduleId: id, change: "resume", date: "2026-05-01", revision: 2 }).snapshot;
  assert.deepEqual(due(snapshot, id, "2026-06-30").map((o) => o.dueDate), ["2026-01-15", "2026-02-15", "2026-05-15", "2026-06-15"]);
  assert.throws(() => pay(snapshot, id, "2026-03"), /while it was paused/);
  const auditBefore = snapshot.auditTrail.length;
  snapshot = act(snapshot, "recurring.schedule_status", { scheduleId: id, change: "stop", date: "2026-05-20", revision: 3 }).snapshot;
  const stopped = findRecurringExpense(snapshot, id);
  assert.equal(stopped.status, "stopped");
  assert.deepEqual(due(snapshot, id, "2026-12-31").map((o) => o.dueDate), ["2026-01-15", "2026-02-15", "2026-05-15"]);
  assert.ok(snapshot.financeTransactions.some((r) => r.id === recurringPaymentRecordId(id, "2026-01")), "payment kept");
  assert.equal(snapshot.auditTrail.length, auditBefore + 1);
  assert.ok(snapshot.auditTrail.filter((event) => event.entityId === id).length >= 4, "every change is in the audit trail");
  assert.throws(() => act(snapshot, "recurring.schedule_status", { scheduleId: id, change: "resume", date: "2026-06-01", revision: 4 }), /only a paused one/);
  assert.throws(() => act(snapshot, "recurring.schedule_save", { ...RENT, startDate: "2026-01-15", scheduleId: id, revision: 4 }), /stopped/);
  // An occurrence due before the stop can still be paid late.
  assert.ok(pay(snapshot, id, "2026-05").snapshot);
});

test("method vs source: only a payment from a driver's takings changes that driver's expected cash, once, and only on an open day", () => {
  const { snapshot, id } = withSchedule({ ...RENT, frequency: "daily", startDate: "2026-10-01", amount: 120 });
  const before = summarizeDriverDayCash(snapshot, { driverStaffId: "uat-drv-01", workDate: "2026-10-01" }).expectedCashIn;
  const businessCash = pay(snapshot, id, "2026-10-01", { amount: 120, paidDate: "2026-10-01", method: "cash", source: "business_cash" }).snapshot;
  assert.equal(summarizeDriverDayCash(businessCash, { driverStaffId: "uat-drv-01", workDate: "2026-10-01" }).expectedCashIn, before);
  assert.throws(() => pay(snapshot, id, "2026-10-01", { method: "cash", source: "driver_takings" }), /whose takings/);
  const takings = pay(snapshot, id, "2026-10-01", { amount: 120, paidDate: "2026-10-01", method: "cash", source: "driver_takings", driverStaffId: "uat-drv-01" }).snapshot;
  assert.equal(summarizeDriverDayCash(takings, { driverStaffId: "uat-drv-01", workDate: "2026-10-01" }).expectedCashIn, before - 120);
  assert.equal(takings.financeTransactions[0].status, "pending");
  // A counted day cannot take it.
  const counted = act(snapshot, "cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: before }, { ...owner, permissions: ["cash.count"] }).snapshot;
  assert.throws(() => pay(counted, id, "2026-10-02", { paidDate: "2026-10-01", method: "cash", source: "driver_takings", driverStaffId: "uat-drv-01" }), (e) => e.statusCode === 409 && /counted/.test(e.message));
  assert.throws(() => pay(snapshot, id, "2026-10-01", { method: "bank", source: "driver_takings", driverStaffId: "uat-drv-01" }), /business bank account/);
});

test("permissions: management with Money edit only; Drivers and no-Money managers neither act nor receive schedules", () => {
  const stored = buildSyntheticSnapshot();
  for (const name of ["recurring.schedule_save", "recurring.schedule_status", "recurring.payment_record"]) {
    assert.deepEqual(FINANCE_ACTIONS[name].roles, ["Owner", "Admin", "Manager"]);
    assert.equal(FINANCE_ACTIONS[name].requiresFinanceEdit, true);
  }
  assert.ok(act(stored, "recurring.schedule_save", RENT, managerWithMoney).snapshot);
  assert.throws(() => act(stored, "recurring.schedule_save", RENT, managerNoMoney), (e) => e.statusCode === 403);
  assert.throws(() => act(stored, "recurring.schedule_save", RENT, driver), (e) => e.statusCode === 403);
  const { snapshot, id } = withSchedule();
  assert.throws(() => pay(snapshot, id, "2026-01", {}, driver), (e) => e.statusCode === 403);
  assert.throws(() => act(stored, "recurring.schedule_save", { ...RENT, vehicleId: "veh-of-another-business" }), (e) => e.statusCode === 404);
  assert.throws(() => request("recurring.schedule_save", { ...RENT, status: "stopped" }), /Unsupported fields/);
  const noMoney = projectWorkspace(snapshot, { email: "m@example.com", role: "Manager", active: true }, WORKSPACE_SCOPES.NO_FINANCE);
  assert.equal(noMoney.finance.recurringExpenses, undefined);
  const driverView = projectWorkspace(snapshot, { email: "d@example.com", role: "Driver", staffId: "uat-drv-01", active: true }, WORKSPACE_SCOPES.DRIVER);
  assert.equal(driverView.finance.recurringExpenses, undefined);
  // Separate from salaries: no arrangement is created, no salary record.
  assert.equal(getSalaryArrangements(snapshot).length, 0);
  assert.equal(getRecurringExpenses(snapshot).length, 1);
});

test("concurrency: two requests built from the same snapshot cannot both record the occurrence", () => {
  const { snapshot, id } = withSchedule();
  const fields = { scheduleId: id, period: "2026-01", paidDate: "2026-10-28", amount: 3000, method: "bank", source: "business_bank" };
  const first = applyFinanceAction(snapshot, request("recurring.payment_record", fields), owner, NOW);
  // The second request applies cleanly to the stale snapshot (same fixed id), so
  // the server's version-checked commit is what stops it; applied to the
  // committed snapshot it is refused outright.
  const second = applyFinanceAction(snapshot, request("recurring.payment_record", fields), owner, NOW);
  assert.equal(first.targetId, second.targetId, "both target the one fixed record id");
  assert.throws(() => applyFinanceAction(first.snapshot, request("recurring.payment_record", fields), owner, NOW), (e) => e.statusCode === 409);
});

test("reports: payments counted once as expenses; commitments separate; business-wide costs unallocated; vehicle-linked in its vehicle report; CSV reconciles", () => {
  let snapshot = buildSyntheticSnapshot();
  const wide = act(snapshot, "recurring.schedule_save", { ...RENT, startDate: "2026-10-05" });
  snapshot = wide.snapshot;
  const tracking = act(snapshot, "recurring.schedule_save", { description: "Tracker", category: "Tracking", amount: 250, frequency: "monthly", startDate: "2026-10-10", vehicleId: "uat-veh-02", payMethod: "bank" });
  snapshot = tracking.snapshot;
  snapshot = pay(snapshot, wide.response.scheduleId, "2026-10", { paidDate: "2026-10-06" }).snapshot;
  const october = { period: "monthly", month: "2026-10" };
  const business = buildPeriodReport(snapshot, { scope: "business", ...october }, { generatedAt: NOW });
  assert.equal(business.transactions.filter((line) => line.id === recurringPaymentRecordId(wide.response.scheduleId, "2026-10")).length, 1);
  assert.ok(business.unallocatedBreakdown.some((group) => group.category === "Rent" && group.amountCents === 300000));
  assert.equal(business.reconciliation.ok, true);
  assert.deepEqual(business.commitments.items.map((item) => [item.description, item.status, item.paidCents]), [["Depot rent", "paid", 300000], ["Tracker", "overdue", null]]);
  assert.equal(business.commitments.scheduledCents, 325000);
  assert.equal(business.commitments.unpaidCents, 25000);
  // Commitments never change the expense totals.
  const withoutSchedules = { ...snapshot, finance: { ...snapshot.finance, recurringExpenses: [] } };
  assert.equal(buildPeriodReport(withoutSchedules, { scope: "business", ...october }, { generatedAt: NOW }).totals.expenseCents, business.totals.expenseCents);
  const vehicle = buildPeriodReport(snapshot, { scope: "vehicle", vehicleId: "uat-veh-02", ...october }, { generatedAt: NOW });
  assert.deepEqual(vehicle.commitments.items.map((item) => item.description), ["Tracker"]);
  assert.ok(!vehicle.transactions.some((line) => line.category === "Rent"), "the business-wide rent is not in a vehicle report");
  const csv = periodReportCsv(business).split("\r\n");
  assert.ok(csv.some((row) => row.startsWith("Scheduled commitments (not expenses; not in any total)")));
  assert.ok(csv.includes("  not recorded,,,,1 occurrences (1 overdue),250.00"));
  const expenseLine = csv.find((row) => row.startsWith("Expenses,"));
  assert.equal(expenseLine, `Expenses,${(business.totals.expenseCents / 100).toFixed(2)}`);
});
