import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyFinanceReportData } from "../api/_lib/dailyFinanceReport.js";
import { FINANCE_ACTIONS, applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { WORKSPACE_SCOPES, projectWorkspace } from "../api/_lib/scopedWorkspace.js";
import { summarizeDriverDayCash } from "../src/lib/cashUpContract.js";
import {
  applySalaryArrangement,
  buildMonthlyExpenseReport,
  buildSalaryPaymentRecord,
  describeSalarySchedule,
  findSalaryPayment,
  formatSalaryPeriod,
  getSalaryArrangements,
  isValidSalaryPeriod,
  monthlyExpenseReportCsv,
  nextSalaryPeriod,
  parseSalaryArrangement,
  parseSalaryPayment,
  salaryPeriodEnd,
  salaryPeriodForDate,
  scheduledAmountFor,
} from "../src/lib/salaryContract.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

const DRIVER = "uat-drv-01";
const DAY = "2026-10-01"; // synthetic driver day: R 700 income, day checking pending
const NOW = "2026-10-28T08:00:00.000Z";
const owner = { id: "u-owner", role: "Owner" };
const admin = { id: "u-admin", role: "Admin", permissions: ["cash.count"], moduleAccess: { finance: true } };
const managerWithMoney = { id: "u-manager", role: "Manager", permissions: ["cash.bank", "cash.verify"], moduleAccess: { finance: true } };
const managerNoMoney = { id: "u-manager2", role: "Manager", permissions: ["cash.bank", "cash.verify"], moduleAccess: { finance: false } };
const driver = { id: "u-driver", role: "Driver", driverStaffId: DRIVER };

let rid = 0;
const nextRid = () => `11111111-1111-4111-8111-${String(++rid).padStart(12, "0")}`;
const request = (action, fields) =>
  parseFinanceActionRequest({ action, requestId: nextRid(), expectedVersion: "2026-10-01T16:30:00Z", fields });

const schedule = { driverStaffId: DRIVER, amount: 6500, frequency: "monthly", payMethod: "bank", startDate: "2026-09-01", active: true };
const withSchedule = (snapshot = buildSyntheticSnapshot(), fields = schedule, requester = owner) =>
  applyFinanceAction(snapshot, request("salary.arrangement_save", fields), requester, NOW).snapshot;
const pay = (snapshot, fields = {}, requester = owner) =>
  applyFinanceAction(
    snapshot,
    request("salary.payment_record", {
      driverStaffId: DRIVER,
      period: "2026-10",
      paidDate: "2026-10-25",
      amount: 6500,
      method: "bank",
      source: "business_bank",
      ...fields,
    }),
    requester,
    NOW,
  );
const expected = (snapshot, workDate = DAY) => summarizeDriverDayCash(snapshot, { driverStaffId: DRIVER, workDate });
const TAKINGS = { frequency: "daily", period: DAY, paidDate: DAY, amount: 250, method: "cash", source: "driver_takings" };

// --- Permissions and parsing -----------------------------------------------------------

test("salary actions: management only, Money edit required (Owner always)", () => {
  for (const name of ["salary.arrangement_save", "salary.payment_record"]) {
    assert.deepEqual(FINANCE_ACTIONS[name].roles, ["Owner", "Admin", "Manager"]);
    assert.equal(FINANCE_ACTIONS[name].requiresFinanceEdit, true);
  }
  const stored = buildSyntheticSnapshot();
  assert.throws(() => withSchedule(stored, schedule, driver), (e) => e.statusCode === 403);
  assert.throws(() => withSchedule(stored, schedule, managerNoMoney), (e) => e.statusCode === 403 && /Money access/.test(e.message));
  assert.throws(() => pay(stored, { frequency: "daily", period: DAY }, driver), (e) => e.statusCode === 403);
  assert.ok(withSchedule(stored, schedule, managerWithMoney));
  assert.ok(withSchedule(stored, schedule, admin));
});

test("request parsing: extra fields refused; method and source must agree", () => {
  const base = { driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: 10, method: "bank", source: "business_bank" };
  assert.throws(() => request("salary.payment_record", { ...base, status: "banked" }), /Unsupported fields/);
  assert.throws(() => request("salary.payment_record", { ...base, amount: 0 }), /valid amount paid/);
  assert.throws(() => request("salary.payment_record", { ...base, method: "eft" }), /bank or cash/);
  assert.throws(() => request("salary.payment_record", { ...base, source: "driver_takings" }), /business bank account/);
  assert.throws(() => request("salary.payment_record", { ...base, method: "cash", source: "business_bank" }), /business cash or the driver's takings/);
  assert.throws(() => request("salary.payment_record", { ...base, frequency: "hourly" }), /daily, weekly, fortnightly or monthly/);
  assert.equal(parseSalaryPayment({ ...base, source: undefined }).source, "business_bank");
  assert.throws(() => request("salary.arrangement_save", { ...schedule, frequency: "yearly" }), /daily, weekly, fortnightly or monthly/);
});

// --- Period boundaries -----------------------------------------------------------------

test("period boundaries: daily, weekly, fortnightly and monthly", () => {
  assert.equal(salaryPeriodForDate("daily", "2026-10-28"), "2026-10-28");
  assert.equal(salaryPeriodEnd("daily", "2026-10-28"), "2026-10-28");
  assert.equal(nextSalaryPeriod("daily", "2026-10-31"), "2026-11-01");
  assert.equal(nextSalaryPeriod("daily", "2028-02-28"), "2028-02-29");
  assert.equal(isValidSalaryPeriod("daily", "2026-02-30"), false);

  assert.equal(salaryPeriodForDate("weekly", "2026-11-01"), "2026-10-26"); // Sunday -> its Monday
  assert.equal(salaryPeriodForDate("weekly", "2026-10-26"), "2026-10-26");
  assert.equal(salaryPeriodEnd("weekly", "2026-10-26"), "2026-11-01");
  assert.equal(nextSalaryPeriod("weekly", "2026-12-28"), "2027-01-04");
  assert.equal(isValidSalaryPeriod("weekly", "2026-10-27"), false);

  const anchor = "2026-10-07"; // Wednesday -> fortnights start Monday 2026-10-05
  assert.equal(salaryPeriodForDate("fortnightly", "2026-10-18", anchor), "2026-10-05");
  assert.equal(salaryPeriodForDate("fortnightly", "2026-10-19", anchor), "2026-10-19");
  assert.equal(salaryPeriodForDate("fortnightly", "2026-09-27", anchor), "2026-09-21");
  assert.equal(salaryPeriodEnd("fortnightly", "2026-10-05"), "2026-10-18");
  assert.equal(isValidSalaryPeriod("fortnightly", "2026-10-12", anchor), false);
  assert.equal(isValidSalaryPeriod("fortnightly", "2026-11-02", anchor), true);
  assert.equal(isValidSalaryPeriod("fortnightly", "2026-10-12"), true); // manual: any Monday

  assert.equal(salaryPeriodEnd("monthly", "2026-02"), "2026-02-28");
  assert.equal(salaryPeriodEnd("monthly", "2028-02"), "2028-02-29");
  assert.equal(nextSalaryPeriod("monthly", "2026-12"), "2027-01");
  assert.equal(isValidSalaryPeriod("monthly", "2026-13"), false);
  assert.equal(formatSalaryPeriod("fortnightly", "2026-10-05"), "Fortnight of 5 Oct 2026");
  assert.equal(formatSalaryPeriod("daily", "2026-10-05"), "5 Oct 2026");
});

test("payments validate the period against the schedule's frequency and start", () => {
  const stored = buildSyntheticSnapshot();
  const fortnightly = withSchedule(stored, { ...schedule, frequency: "fortnightly", startDate: "2026-10-07", amount: 3000 });
  assert.throws(() => pay(fortnightly, { frequency: "fortnightly", period: "2026-10-12" }), /one of this schedule's fortnights/);
  assert.throws(() => pay(fortnightly, { frequency: "fortnightly", period: "2026-09-21" }), /before the salary schedule started/);
  const ok = pay(fortnightly, { frequency: "fortnightly", period: "2026-10-19", amount: 3000 }).snapshot.financeTransactions[0];
  assert.equal(ok.salaryPayment.periodEnd, "2026-11-01");
  assert.throws(() => pay(withSchedule(stored), { period: "2026-10-05" }), /Choose a month/);
  const weekly = withSchedule(stored, { ...schedule, frequency: "weekly" });
  assert.throws(() => pay(weekly, { frequency: "weekly", period: "2026-10-28" }), /Monday/);
});

// --- Schedule vs payment ---------------------------------------------------------------

test("a schedule is not a payment: no expense, no cash change, not in expense totals", () => {
  const stored = buildSyntheticSnapshot();
  const next = withSchedule(stored);
  assert.deepEqual(next.financeTransactions, stored.financeTransactions);
  assert.deepEqual(next.dailyCashUps, stored.dailyCashUps);
  assert.deepEqual(buildMonthlyExpenseReport(next, "2026-10").totals, buildMonthlyExpenseReport(stored, "2026-10").totals);
  assert.equal(getSalaryArrangements(next)[0].amountHistory.length, 1);
});

test("manual payment needs no schedule and keeps no scheduled amount", () => {
  const stored = buildSyntheticSnapshot();
  const { snapshot } = pay(stored, { frequency: "daily", period: "2026-10-02", paidDate: "2026-10-02", amount: 350, method: "cash", source: "business_cash" });
  const record = snapshot.financeTransactions[0];
  assert.equal(record.salaryPayment.manual, true);
  assert.equal(record.salaryPayment.arrangementId, null);
  assert.equal(record.salaryPayment.scheduledAmount, null);
  assert.equal(record.amount, 350);
  assert.throws(() => pay(stored, { period: "2026-10" }), /how often/);
  const other = pay(withSchedule(stored), { frequency: "daily", period: DAY, paidDate: DAY, amount: 200 }).snapshot.financeTransactions[0];
  assert.equal(other.salaryPayment.manual, true);
});

test("one expense per driver, frequency and period; a duplicate is refused", () => {
  const scheduled = withSchedule();
  const before = scheduled.financeTransactions.length;
  const { snapshot, targetId } = pay(scheduled);
  assert.equal(snapshot.financeTransactions.length, before + 1);
  assert.equal(snapshot.financeTransactions.filter((record) => record.id === targetId).length, 1);
  assert.equal(snapshot.financeTransactions[0].category, "Salary");
  assert.equal(snapshot.financeTransactions[0].status, "verified");
  assert.throws(() => pay(snapshot, { amount: 6000, paidDate: "2026-10-26" }), (e) => e.statusCode === 409 && /already recorded/.test(e.message));
  assert.throws(() => pay(snapshot, { method: "cash", source: "driver_takings", paidDate: "2026-10-02" }), (e) => e.statusCode === 409);
  assert.equal(pay(snapshot, { period: "2026-11", paidDate: "2026-11-25" }).snapshot.financeTransactions.length, before + 2);
});

// --- Source and cash hand-in -----------------------------------------------------------

test("bank and business-cash salaries leave the driver's expected cash unchanged", () => {
  const scheduled = withSchedule();
  const baseline = expected(scheduled);
  assert.equal(baseline.expectedCashIn, 700);
  for (const fields of [{ method: "bank", source: "business_bank" }, { method: "cash", source: "business_cash" }]) {
    const { snapshot } = pay(scheduled, { ...fields, paidDate: DAY });
    const after = expected(snapshot);
    assert.equal(after.expectedCashIn, 700, fields.source);
    assert.equal(after.entryCount, baseline.entryCount, fields.source);
    assert.equal(snapshot.financeTransactions[0].driverStaffId, null);
    assert.equal(snapshot.financeTransactions[0].cashExpense, fields.method === "cash");
  }
});

test("a salary from the driver's takings lowers that day's expected cash exactly once", () => {
  const scheduled = withSchedule(buildSyntheticSnapshot(), { ...schedule, frequency: "daily", startDate: "2026-09-01", amount: 250 });
  const { snapshot } = pay(scheduled, TAKINGS);
  const record = snapshot.financeTransactions[0];
  assert.equal(record.driverStaffId, DRIVER);
  assert.equal(record.cashExpense, true);
  assert.equal(record.status, "pending");
  assert.equal(record.timestamp, "2026-10-01T10:00:00.000Z"); // 12:00 SAST on the paid date, like other server captures
  const after = expected(snapshot);
  assert.equal(after.expectedCashIn, 450);
  assert.equal(after.cashExpenses, 250);
  assert.equal(after.expenseRecords.filter((item) => item.id === record.id).length, 1);
  assert.equal(expected(snapshot, "2026-10-02").expectedCashIn, expected(scheduled, "2026-10-02").expectedCashIn);
  const report = buildMonthlyExpenseReport(snapshot, "2026-10");
  assert.equal(report.lines.filter((line) => line.id === record.id).length, 1);
  assert.equal(report.totals.salariesFromTakings, 250);
  assert.equal(report.totals.salaries, 250);
  const counted = applyFinanceAction(snapshot, request("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 450 }), admin, NOW);
  assert.equal(counted.response.expectedCashIn, 450);
  assert.equal(counted.response.variance, 0);
});

test("a takings-funded salary is refused on a counted day; business cash still allowed", () => {
  const scheduled = withSchedule(buildSyntheticSnapshot(), { ...schedule, frequency: "daily", startDate: "2026-09-01", amount: 250 });
  const counted = applyFinanceAction(scheduled, request("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 700 }), admin, NOW).snapshot;
  assert.throws(() => pay(counted, TAKINGS), (e) => e.statusCode === 409 && /counted/.test(e.message));
  assert.ok(pay(counted, { ...TAKINGS, source: "business_cash" }));
});

test("recorded salaries cannot be edited through the generic record edit", () => {
  const scheduled = withSchedule(buildSyntheticSnapshot(), { ...schedule, frequency: "daily", amount: 250 });
  const { snapshot, targetId } = pay(scheduled, TAKINGS);
  assert.throws(
    () => applyFinanceAction(snapshot, request("record.edit", { recordId: targetId, changes: { amount: 10 } }), owner, NOW),
    (e) => e.statusCode === 409 && /cannot be edited/.test(e.message),
  );
});

// --- History, next payment and due -----------------------------------------------------

test("historical amounts survive a schedule change; scheduled amount follows the effective date", () => {
  const paid = pay(withSchedule()).snapshot;
  const raised = withSchedule(paid, { ...schedule, amount: 7000, effectiveFrom: "2026-11-01" });
  const october = findSalaryPayment(raised, DRIVER, "monthly", "2026-10");
  assert.equal(october.amount, 6500);
  assert.equal(october.salaryPayment.scheduledAmount, 6500);
  const arrangement = getSalaryArrangements(raised)[0];
  assert.equal(scheduledAmountFor(arrangement, "2026-10-01"), 6500);
  assert.equal(scheduledAmountFor(arrangement, "2026-11-01"), 7000);
  const november = pay(raised, { period: "2026-11", paidDate: "2026-11-25", amount: 7000 }).snapshot.financeTransactions[0];
  assert.equal(november.salaryPayment.scheduledAmount, 7000);
  const paidDifferent = pay(withSchedule(), { amount: 6200 }).snapshot.financeTransactions[0];
  assert.equal(paidDifferent.amount, 6200);
  assert.equal(paidDifferent.salaryPayment.scheduledAmount, 6500);
});

test("next payment date and due amounts", () => {
  const stored = withSchedule(); // monthly from 2026-09-01, R 6 500
  const [arrangement] = getSalaryArrangements(stored);
  let status = describeSalarySchedule(stored, arrangement, "2026-10-28");
  assert.deepEqual(status.due.map((item) => item.period), ["2026-09"]);
  assert.equal(status.dueAmount, 6500);
  assert.equal(status.next.period, "2026-09");
  assert.equal(status.next.dueDate, "2026-09-30");
  assert.equal(status.current.period, "2026-10");

  const paidSeptember = pay(stored, { period: "2026-09", paidDate: "2026-09-30" }).snapshot;
  status = describeSalarySchedule(paidSeptember, arrangement, "2026-10-28");
  assert.equal(status.due.length, 0);
  assert.equal(status.next.period, "2026-10");
  assert.equal(status.next.dueDate, "2026-10-31");
  assert.equal(status.next.scheduledAmount, 6500);

  status = describeSalarySchedule(pay(paidSeptember).snapshot, arrangement, "2026-10-28");
  assert.equal(status.next.period, "2026-11");
  assert.equal(status.next.dueDate, "2026-11-30");

  const daily = getSalaryArrangements(withSchedule(buildSyntheticSnapshot(), { ...schedule, frequency: "daily", startDate: "2026-10-26", amount: 200 }))[0];
  const dailyStatus = describeSalarySchedule(buildSyntheticSnapshot(), daily, "2026-10-28");
  assert.deepEqual(dailyStatus.due.map((item) => item.period), ["2026-10-26", "2026-10-27", "2026-10-28"]);
  assert.equal(dailyStatus.dueAmount, 600);
});

// --- Visibility and reports ------------------------------------------------------------

test("drivers see only their own takings-funded salary and no schedules; no-Money managers see none", () => {
  let snapshot = withSchedule();
  snapshot = pay(snapshot).snapshot;
  snapshot = pay(snapshot, { ...TAKINGS, amount: 100 }).snapshot;
  const member = { email: "driver@example.com", role: "Driver", staffId: DRIVER, active: true };
  const driverView = projectWorkspace(snapshot, member, WORKSPACE_SCOPES.DRIVER);
  assert.equal(driverView.finance.salaryArrangements, undefined);
  assert.deepEqual(
    driverView.financeTransactions.filter((record) => record.salaryPayment).map((record) => record.salaryPayment.source),
    ["driver_takings"],
  );
  const noMoney = projectWorkspace(snapshot, { email: "m@example.com", role: "Manager", active: true }, WORKSPACE_SCOPES.NO_FINANCE);
  assert.equal(noMoney.finance.salaryArrangements, undefined);
  assert.equal(noMoney.financeTransactions.length, 0);
});

test("monthly expense report: salary lines itemised once, schedules excluded, totals reconcile", () => {
  let snapshot = withSchedule();
  snapshot = pay(snapshot, { method: "cash", source: "business_cash", amount: 6200 }).snapshot;
  snapshot = pay(snapshot, { ...TAKINGS, amount: 150 }).snapshot;
  snapshot = pay(snapshot, { period: "2026-11", paidDate: "2026-11-25" }).snapshot;
  const octoberExpenses = snapshot.financeTransactions.filter((record) => record.type === "expense" && record.expenseDate.startsWith("2026-10"));
  const report = buildMonthlyExpenseReport(snapshot, "2026-10");
  assert.equal(report.lines.length, octoberExpenses.length);
  assert.equal(report.totals.salaryCount, 2);
  assert.equal(report.totals.salaries, 6350);
  assert.equal(report.totals.salariesFromTakings, 150);
  assert.equal(Math.round(report.totals.expenses * 100), Math.round(octoberExpenses.reduce((sum, record) => sum + record.amount, 0) * 100));
  assert.equal(report.totals.reconciles, true);
  const csv = monthlyExpenseReportCsv(report, "UAT Fleet");
  assert.equal(csv.split("Driver salary / UAT Driver / October 2026").length - 1, 1);
  assert.match(csv, /cash,Business cash \(safe or office\),verified,,UAT Driver,October 2026,6500\.00,6200\.00/);
  assert.match(csv, /cash,Driver's takings for the day,pending,,UAT Driver,1 Oct 2026,manual,150\.00/);
  assert.match(csv, /of which paid from drivers' takings,.*,150\.00/);
  assert.match(csv, /Reconciles,yes/);
  assert.doesNotMatch(csv, /November 2026/);
});

test("daily finance report (PDF and preview data) lists a salary taken from that day's takings", () => {
  const scheduled = withSchedule(buildSyntheticSnapshot(), { ...schedule, frequency: "daily", amount: 250 });
  assert.deepEqual(buildDailyFinanceReportData(scheduled, "uat-fin-1").cashUp.salaryFromTakings, []);
  const banked = pay(scheduled, { ...TAKINGS, method: "bank", source: "business_bank" }).snapshot;
  assert.deepEqual(buildDailyFinanceReportData(banked, "uat-fin-1").cashUp.salaryFromTakings, []);
  assert.equal(buildDailyFinanceReportData(banked, "uat-fin-1").cashUp.expectedCashHandIn, 700);
  const report = buildDailyFinanceReportData(pay(scheduled, TAKINGS).snapshot, "uat-fin-1");
  assert.deepEqual(report.cashUp.salaryFromTakings, [{ driverName: "UAT Driver", period: "1 Oct 2026", amount: 250 }]);
  assert.equal(report.cashUp.cashExpenses, 250);
  assert.equal(report.cashUp.expectedCashHandIn, 450);
});

test("shared rules run the same outside the server (demo and legacy saves)", () => {
  const stored = buildSyntheticSnapshot();
  const { finance } = applySalaryArrangement(stored, parseSalaryArrangement(schedule), owner, NOW);
  const withArrangement = { ...stored, finance };
  const parsed = parseSalaryPayment({ driverStaffId: DRIVER, period: "2026-10", paidDate: "2026-10-25", amount: "6500", method: "bank" });
  const { record } = buildSalaryPaymentRecord(withArrangement, parsed, owner, NOW);
  assert.equal(record.id, `txn-salary-${DRIVER}-monthly-2026-10`);
  const twice = { ...withArrangement, financeTransactions: [record, ...withArrangement.financeTransactions] };
  assert.throws(() => buildSalaryPaymentRecord(twice, parsed, owner, NOW), /already recorded/);
});
