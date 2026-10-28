import assert from "node:assert/strict";
import test from "node:test";

import { FINANCE_ACTIONS, applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { WORKSPACE_SCOPES, projectWorkspace } from "../api/_lib/scopedWorkspace.js";
import { summarizeDriverDayCash } from "../src/lib/cashUpContract.js";
import {
  applySalaryArrangement,
  buildMonthlyExpenseReport,
  buildSalaryPaymentRecord,
  findSalaryPayment,
  formatSalaryPeriod,
  getSalaryArrangements,
  isValidSalaryPeriod,
  monthlyExpenseReportCsv,
  parseSalaryArrangement,
  parseSalaryPayment,
  salaryPeriodForDate,
} from "../src/lib/salaryContract.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

const DRIVER = "uat-drv-01";
const NOW = "2026-10-28T08:00:00.000Z";
const owner = { id: "u-owner", role: "Owner" };
const managerWithMoney = { id: "u-manager", role: "Manager", permissions: ["cash.bank", "cash.verify"], moduleAccess: { finance: true } };
const managerNoMoney = { id: "u-manager2", role: "Manager", permissions: ["cash.bank", "cash.verify"], moduleAccess: { finance: false } };
const admin = { id: "u-admin", role: "Admin", permissions: ["cash.count"], moduleAccess: { finance: true } };
const driver = { id: "u-driver", role: "Driver", driverStaffId: DRIVER };

let rid = 0;
const nextRid = () => `11111111-1111-4111-8111-${String(++rid).padStart(12, "0")}`;
const request = (action, fields) =>
  parseFinanceActionRequest({ action, requestId: nextRid(), expectedVersion: "2026-10-01T16:30:00Z", fields });

const schedule = { driverStaffId: DRIVER, amount: 6500, frequency: "monthly", payMethod: "bank", startDate: "2026-09-01", active: true };
const withSchedule = (snapshot = buildSyntheticSnapshot(), fields = schedule, requester = owner) =>
  applyFinanceAction(snapshot, request("salary.arrangement_save", fields), requester, NOW).snapshot;
const pay = (snapshot, fields, requester = owner) =>
  applyFinanceAction(
    snapshot,
    request("salary.payment_record", { driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: 6500, method: "bank", ...fields }),
    requester,
    NOW,
  );

test("salary actions: management only, Money edit required (Owner always)", () => {
  for (const name of ["salary.arrangement_save", "salary.payment_record"]) {
    assert.deepEqual(FINANCE_ACTIONS[name].roles, ["Owner", "Admin", "Manager"]);
    assert.equal(FINANCE_ACTIONS[name].requiresFinanceEdit, true);
  }
  const stored = buildSyntheticSnapshot();
  assert.throws(() => withSchedule(stored, schedule, driver), (e) => e.statusCode === 403);
  assert.throws(() => withSchedule(stored, schedule, managerNoMoney), (e) => e.statusCode === 403 && /Money access/.test(e.message));
  assert.ok(withSchedule(stored, schedule, managerWithMoney));
  assert.ok(withSchedule(stored, schedule, admin));
});

test("request parsing rejects extra fields and bad values", () => {
  assert.throws(() => request("salary.payment_record", { driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: 1, method: "bank", status: "banked" }), /Unsupported fields/);
  assert.throws(() => request("salary.payment_record", { driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: 0, method: "bank" }), /valid amount paid/);
  assert.throws(() => request("salary.payment_record", { driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: 5, method: "eft" }), /bank or cash/);
  assert.throws(() => request("salary.arrangement_save", { ...schedule, frequency: "daily" }), /monthly or weekly/);
});

test("a schedule is not a payment: saving it adds no expense and changes no cash records", () => {
  const stored = buildSyntheticSnapshot();
  const next = withSchedule(stored);
  assert.deepEqual(next.financeTransactions, stored.financeTransactions);
  assert.deepEqual(next.dailyCashUps, stored.dailyCashUps);
  assert.deepEqual(next.deposits, stored.deposits);
  const [arrangement] = getSalaryArrangements(next);
  assert.equal(arrangement.amount, 6500);
  assert.equal(arrangement.amountHistory.length, 1);
  assert.equal(next.auditTrail[0].entityType, "salary-arrangement");
});

test("recording a payment adds exactly one verified Salary expense, and a second one for the same period is refused", () => {
  const scheduled = withSchedule();
  const before = scheduled.financeTransactions.length;
  const { snapshot } = pay(scheduled);
  assert.equal(snapshot.financeTransactions.length, before + 1);
  const record = snapshot.financeTransactions[0];
  assert.equal(record.type, "expense");
  assert.equal(record.category, "Salary");
  assert.equal(record.status, "verified");
  assert.equal(record.amount, 6500);
  assert.equal(record.cashExpense, false);
  assert.equal(record.driverStaffId, null);
  assert.equal(record.salaryPayment.driverStaffId, DRIVER);
  assert.equal(record.salaryPayment.period, "2026-10");
  assert.deepEqual(snapshot.dailyCashUps, scheduled.dailyCashUps);

  // Same driver and period again (new request id, different amount): refused.
  assert.throws(() => pay(snapshot, { amount: 6000, paidDate: "2026-10-26" }), (e) => e.statusCode === 409 && /already recorded/.test(e.message));
  // The next period is fine.
  assert.equal(pay(snapshot, { period: "2026-11", paidDate: "2026-11-25" }).snapshot.financeTransactions.length, before + 2);
});

test("historical amounts survive a schedule change", () => {
  const paid = pay(withSchedule()).snapshot;
  const raised = withSchedule(paid, { ...schedule, amount: 7000 });
  const october = findSalaryPayment(raised, DRIVER, "2026-10");
  assert.equal(october.amount, 6500);
  assert.equal(october.salaryPayment.scheduledAmount, 6500);
  assert.deepEqual(getSalaryArrangements(raised)[0].amountHistory.map((entry) => entry.amount), [6500, 7000]);
  const november = pay(raised, { period: "2026-11", paidDate: "2026-11-25", amount: 7000 }).snapshot.financeTransactions[0];
  assert.equal(november.salaryPayment.scheduledAmount, 7000);
});

test("a paid amount different from the schedule is kept as paid, with the scheduled amount alongside", () => {
  const record = pay(withSchedule(), { amount: 6200 }).snapshot.financeTransactions[0];
  assert.equal(record.amount, 6200);
  assert.equal(record.salaryPayment.scheduledAmount, 6500);
});

test("payments need an active schedule and a valid period not before the start", () => {
  const stored = buildSyntheticSnapshot();
  assert.throws(() => pay(stored), (e) => e.statusCode === 409 && /salary schedule/.test(e.message));
  const paused = withSchedule(stored, { ...schedule, active: false });
  assert.throws(() => pay(paused), (e) => e.statusCode === 409 && /paused/.test(e.message));
  const scheduled = withSchedule(stored);
  assert.throws(() => pay(scheduled, { period: "2026-08" }), /before the salary started/);
  assert.throws(() => pay(scheduled, { period: "2026-10-05" }), /Choose a month/);
  const weekly = withSchedule(stored, { ...schedule, frequency: "weekly" });
  assert.throws(() => pay(weekly, { period: "2026-10-28" }), /Monday/);
  assert.equal(pay(weekly, { period: "2026-10-26" }).snapshot.financeTransactions[0].salaryPayment.periodLabel, "Week of 26 Oct 2026");
});

test("salary by bank or in cash never changes the driver's day cash hand-in", () => {
  const scheduled = withSchedule();
  // 2026-10-01: the synthetic driver's day with income (expected cash in R 700).
  const workDate = "2026-10-01";
  const baseline = summarizeDriverDayCash(scheduled, { driverStaffId: DRIVER, workDate });
  assert.ok(baseline.entryCount > 0 && baseline.expectedCashIn > 0);
  for (const method of ["bank", "cash"]) {
    const { snapshot } = pay(scheduled, { method, period: "2026-10", paidDate: workDate });
    const after = summarizeDriverDayCash(snapshot, { driverStaffId: DRIVER, workDate });
    assert.equal(after.expectedCashIn, baseline.expectedCashIn, method);
    assert.equal(after.cashExpenses, baseline.cashExpenses, method);
    assert.equal(after.entryCount, baseline.entryCount, method);
    assert.equal(snapshot.financeTransactions[0].cashExpense, method === "cash");
  }
});

test("drivers and no-Money managers never receive salary schedules or salary payments", () => {
  const paid = pay(withSchedule()).snapshot;
  const member = { email: "driver@example.com", role: "Driver", staffId: DRIVER, active: true };
  const driverView = projectWorkspace(paid, member, WORKSPACE_SCOPES.DRIVER);
  assert.equal(driverView.finance.salaryArrangements, undefined);
  assert.ok(!driverView.financeTransactions.some((record) => record.salaryPayment));
  const noMoney = projectWorkspace(paid, { email: "m@example.com", role: "Manager", active: true }, WORKSPACE_SCOPES.NO_FINANCE);
  assert.equal(noMoney.finance.salaryArrangements, undefined);
  assert.equal(noMoney.financeTransactions.length, 0);
});

test("the monthly expense report itemises salaries and reconciles to the expense total", () => {
  const scheduled = withSchedule();
  const paid = pay(pay(scheduled, { method: "cash", amount: 6200 }).snapshot, { period: "2026-11", paidDate: "2026-11-25" }).snapshot;
  const expensesInOctober = paid.financeTransactions.filter((record) => record.type === "expense" && String(record.expenseDate).startsWith("2026-10"));
  const report = buildMonthlyExpenseReport(paid, "2026-10");
  assert.equal(report.lines.length, expensesInOctober.length);
  assert.equal(report.totals.salaryCount, 1);
  assert.equal(report.totals.salaries, 6200);
  assert.equal(
    Math.round(report.totals.expenses * 100),
    Math.round(expensesInOctober.reduce((sum, record) => sum + Number(record.amount), 0) * 100),
  );
  assert.equal(Math.round((report.totals.salaries + report.totals.otherExpenses) * 100), Math.round(report.totals.expenses * 100));
  assert.equal(report.totals.reconciles, true);

  const csv = monthlyExpenseReportCsv(report, "UAT Fleet");
  assert.match(csv, /Driver salary \/ UAT Driver \/ October 2026/);
  assert.match(csv, /UAT Driver,October 2026,6500\.00,6200\.00/);
  assert.match(csv, /Driver salaries,.*1 payments,6200\.00/);
  assert.match(csv, /Reconciles,yes/);
  // The November salary is not in the October report.
  assert.doesNotMatch(csv, /November 2026/);
});

test("period helpers", () => {
  assert.equal(salaryPeriodForDate("monthly", "2026-10-28"), "2026-10");
  assert.equal(salaryPeriodForDate("weekly", "2026-10-28"), "2026-10-26");
  assert.equal(salaryPeriodForDate("weekly", "2026-11-01"), "2026-10-26");
  assert.equal(isValidSalaryPeriod("monthly", "2026-13"), false);
  assert.equal(formatSalaryPeriod("monthly", "2026-02"), "February 2026");
});

test("shared rules run the same outside the server (demo and legacy saves)", () => {
  const stored = buildSyntheticSnapshot();
  const { finance } = applySalaryArrangement(stored, parseSalaryArrangement(schedule), owner, NOW);
  const withArrangement = { ...stored, finance };
  const parsed = parseSalaryPayment({ driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: "6500", method: "bank" });
  const { record } = buildSalaryPaymentRecord(withArrangement, parsed, owner, NOW);
  assert.equal(record.id, `txn-salary-${DRIVER}-2026-10`);
  const twice = { ...withArrangement, financeTransactions: [record, ...withArrangement.financeTransactions] };
  assert.throws(() => buildSalaryPaymentRecord(twice, parsed, owner, NOW), /already recorded/);
});

test("unpaid schedules never reach expense totals; each payment is counted exactly once", () => {
  const stored = buildSyntheticSnapshot();
  const baseline = buildMonthlyExpenseReport(stored, "2026-10");
  const scheduled = withSchedule(stored);
  const scheduledOnly = buildMonthlyExpenseReport(scheduled, "2026-10");
  assert.equal(scheduledOnly.totals.expenses, baseline.totals.expenses);
  assert.equal(scheduledOnly.totals.salaryCount, 0);

  const { snapshot, targetId } = pay(scheduled, { amount: 6500 });
  const report = buildMonthlyExpenseReport(snapshot, "2026-10");
  assert.equal(report.lines.filter((line) => line.id === targetId).length, 1);
  assert.equal(Math.round((report.totals.expenses - baseline.totals.expenses) * 100), 650000);
  assert.equal(snapshot.financeTransactions.filter((record) => record.id === targetId).length, 1);
  const csv = monthlyExpenseReportCsv(report);
  assert.equal(csv.split("Driver salary / UAT Driver / October 2026").length - 1, 1);
});
