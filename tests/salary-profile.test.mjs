import assert from "node:assert/strict";
import test from "node:test";

import { FINANCE_ACTIONS, applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { WORKSPACE_SCOPES, projectWorkspace } from "../api/_lib/scopedWorkspace.js";
import { buildPeriodReport } from "../src/lib/periodReport.js";
import {
  buildMonthlyExpenseReport,
  describeSalarySchedule,
  getSalaryArrangements,
  getSalaryPayments,
  parseSalaryArrangement,
  salaryArrangementForDriver,
  salaryArrangementRevision,
  scheduledAmountFor,
} from "../src/lib/salaryContract.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Salary settings in the driver profile (Prompt 2): the profile uses the one
// salary arrangement model and actions (salary.arrangement_save); salary access
// is Money edit access and never follows from managing driver profiles.

const DRIVER = "uat-drv-01";
const NOW = "2026-10-28T08:00:00.000Z";
const owner = { id: "u-owner", role: "Owner" };
// Manages driver profiles but has Money switched off.
const profileManager = { id: "u-pm", role: "Manager", permissions: ["drivers.manage"], moduleAccess: { finance: false, drivers: true } };
// Has Money but was not given driver-profile management.
const moneyManager = { id: "u-mm", role: "Manager", permissions: ["cash.verify"], moduleAccess: { finance: true, drivers: true } };

let rid = 0;
const request = (action, fields) =>
  parseFinanceActionRequest({ action, requestId: `22222222-2222-4222-8222-${String(++rid).padStart(12, "0")}`, expectedVersion: "2026-10-01T16:30:00Z", fields });
const act = (snapshot, action, fields, requester = owner, now = NOW) => applyFinanceAction(snapshot, request(action, fields), requester, now);
const schedule = { driverStaffId: DRIVER, amount: 300, frequency: "daily", payMethod: "bank", startDate: "2026-10-20", active: true };

test("payment timing: defaults to the end of each period; 'start' makes a period due on its first day", () => {
  assert.equal(parseSalaryArrangement(schedule).payTiming, "end");
  assert.throws(() => request("salary.arrangement_save", { ...schedule, payTiming: "sometimes" }), /start or the end/);
  const weeklyEnd = act(buildSyntheticSnapshot(), "salary.arrangement_save", { ...schedule, frequency: "weekly", startDate: "2026-10-19" }).snapshot;
  const weeklyStart = act(buildSyntheticSnapshot(), "salary.arrangement_save", { ...schedule, frequency: "weekly", startDate: "2026-10-19", payTiming: "start" }).snapshot;
  const status = (snapshot) => describeSalarySchedule(snapshot, getSalaryArrangements(snapshot)[0], "2026-10-28");
  assert.equal(status(weeklyEnd).current.dueDate, "2026-11-01");
  assert.equal(status(weeklyEnd).due.length, 1); // the week of 19 Oct has ended
  assert.equal(status(weeklyStart).current.dueDate, "2026-10-26");
  assert.equal(status(weeklyStart).due.length, 2); // in advance: this week is due too
  assert.equal(getSalaryArrangements(weeklyStart)[0].payTiming, "start");
});

test("no silent overwrite: a second schedule or a stale edit is refused; each save advances the revision", () => {
  const first = act(buildSyntheticSnapshot(), "salary.arrangement_save", schedule).snapshot;
  assert.equal(salaryArrangementRevision(salaryArrangementForDriver(first, DRIVER)), 1);
  assert.throws(() => act(first, "salary.arrangement_save", { ...schedule, amount: 999 }), (e) => e.statusCode === 409 && /already has a salary schedule/.test(e.message));
  const second = act(first, "salary.arrangement_save", { ...schedule, amount: 350, effectiveFrom: "2026-10-25", revision: 1 }).snapshot;
  assert.equal(salaryArrangementForDriver(second, DRIVER).revision, 2);
  assert.throws(() => act(second, "salary.arrangement_save", { ...schedule, amount: 400, revision: 1 }), (e) => e.statusCode === 409 && /changed by someone else/.test(e.message));
  assert.throws(() => act(buildSyntheticSnapshot(), "salary.arrangement_save", { ...schedule, revision: 3 }), (e) => e.statusCode === 409);
  // A schedule stored before revisions existed is revision 1.
  const legacy = buildSyntheticSnapshot();
  legacy.finance = { ...legacy.finance, salaryArrangements: [{ ...salaryArrangementForDriver(first, DRIVER), revision: undefined }] };
  assert.equal(salaryArrangementForDriver(act(legacy, "salary.arrangement_save", { ...schedule, active: false, revision: 1 }).snapshot, DRIVER).revision, 2);
});

test("history: earlier amounts and dates are kept; a change may not start before the last change", () => {
  let snapshot = act(buildSyntheticSnapshot(), "salary.arrangement_save", schedule).snapshot;
  snapshot = act(snapshot, "salary.arrangement_save", { ...schedule, amount: 350, effectiveFrom: "2026-10-25", revision: 1 }).snapshot;
  assert.throws(() => act(snapshot, "salary.arrangement_save", { ...schedule, amount: 380, effectiveFrom: "2026-10-22", revision: 2 }), /cannot apply before the last change \(2026-10-25\)/);
  // Pausing (no amount change) keeps the history and its dates exactly.
  snapshot = act(snapshot, "salary.arrangement_save", { ...schedule, amount: 350, active: false, revision: 2 }).snapshot;
  const arrangement = salaryArrangementForDriver(snapshot, DRIVER);
  assert.equal(arrangement.active, false);
  assert.deepEqual(arrangement.amountHistory.map((entry) => [entry.amount, entry.effectiveFrom]), [[300, "2026-10-20"], [350, "2026-10-25"]]);
  assert.equal(scheduledAmountFor(arrangement, "2026-10-24"), 300);
  assert.equal(scheduledAmountFor(arrangement, "2026-10-25"), 350);
  assert.equal(describeSalarySchedule(snapshot, arrangement, "2026-10-28").active, false);
});

test("saving a schedule (new, changed or paused) never records a payment or any expense", () => {
  const stored = buildSyntheticSnapshot();
  let snapshot = act(stored, "salary.arrangement_save", schedule).snapshot;
  snapshot = act(snapshot, "salary.arrangement_save", { ...schedule, amount: 320, effectiveFrom: "2026-10-27", revision: 1 }).snapshot;
  snapshot = act(snapshot, "salary.arrangement_save", { ...schedule, amount: 320, active: false, revision: 2 }).snapshot;
  assert.deepEqual(snapshot.financeTransactions, stored.financeTransactions);
  assert.deepEqual(snapshot.dailyCashUps ?? [], stored.dailyCashUps ?? []);
  assert.equal(getSalaryPayments(snapshot).length, 0);
});

test("permission split: managing driver profiles does not grant salary access, and Money does not grant profile edits", () => {
  const stored = buildSyntheticSnapshot();
  assert.equal(FINANCE_ACTIONS["salary.arrangement_save"].requiresFinanceEdit, true);
  assert.equal(FINANCE_ACTIONS["driver.save"].permission, "drivers.manage");
  // Profile manager: may save the profile, may not set or record a salary.
  assert.ok(act(stored, "driver.save", { staffId: DRIVER, name: "UAT Driver Renamed" }, profileManager).snapshot);
  assert.throws(() => act(stored, "salary.arrangement_save", schedule, profileManager), (e) => e.statusCode === 403 && /Money access/.test(e.message));
  assert.throws(() => act(stored, "salary.payment_record", { driverStaffId: DRIVER, frequency: "daily", period: "2026-10-27", paidDate: "2026-10-27", amount: 300, method: "bank", source: "business_bank" }, profileManager), (e) => e.statusCode === 403);
  // Money manager: may set the salary, may not edit the profile.
  assert.ok(act(stored, "salary.arrangement_save", schedule, moneyManager).snapshot);
  assert.throws(() => act(stored, "driver.save", { staffId: DRIVER, name: "X" }, moneyManager), (e) => e.statusCode === 403);
});

test("driver profile saves carry no salary: salary fields are refused and the profile response holds none", () => {
  assert.throws(() => request("driver.save", { name: "New Driver", salaryAmount: 300 }), /Unsupported fields/);
  assert.throws(() => request("driver.save", { name: "New Driver", salary: { amount: 300 } }), /Unsupported fields/);
  const withSalary = act(buildSyntheticSnapshot(), "salary.arrangement_save", schedule).snapshot;
  const saved = act(withSalary, "driver.save", { staffId: DRIVER, name: "UAT Driver" });
  assert.deepEqual(Object.keys(saved.response).sort(), ["action", "created", "staffId"]);
  assert.ok(!JSON.stringify(saved.response).includes("salary"));
  const profile = saved.snapshot.drivers.find((driver) => driver.staffId === DRIVER);
  assert.ok(!Object.keys(profile).some((key) => /salary|pay/i.test(key)), "the driver record has no salary fields");
});

test("API responses: a profile manager without Money, and a Driver, receive no salary settings or salary records", () => {
  let snapshot = act(buildSyntheticSnapshot(), "salary.arrangement_save", schedule).snapshot;
  snapshot = act(snapshot, "salary.payment_record", { driverStaffId: DRIVER, frequency: "daily", period: "2026-10-27", paidDate: "2026-10-27", amount: 300, method: "bank", source: "business_bank" }).snapshot;
  const noMoney = projectWorkspace(snapshot, { email: "pm@example.com", role: "Manager", active: true }, WORKSPACE_SCOPES.NO_FINANCE);
  assert.equal(noMoney.finance.salaryArrangements, undefined);
  assert.equal(noMoney.financeTransactions.length, 0);
  assert.ok(!JSON.stringify(noMoney).includes("salary-"), "no salary schedule id anywhere");
  assert.ok(noMoney.drivers.some((driver) => driver.staffId === DRIVER), "the profile itself is still visible");
  const driverView = projectWorkspace(snapshot, { email: "driver@example.com", role: "Driver", staffId: DRIVER, active: true }, WORKSPACE_SCOPES.DRIVER);
  assert.equal(driverView.finance.salaryArrangements, undefined);
  assert.ok(!(driverView.financeTransactions ?? []).some((record) => record.salaryPayment?.source === "business_bank"));
});

test("profile -> payment -> report: a new driver with a salary, one payment, counted once in the reports", () => {
  // 1. Create the driver profile (no salary in it).
  const created = act(buildSyntheticSnapshot(), "driver.save", { name: "Profile Flow Driver" });
  const staffId = created.response.staffId;
  assert.equal(created.response.created, true);
  // 2. Salary settings for the new profile through the one arrangement action.
  let snapshot = act(created.snapshot, "salary.arrangement_save", { driverStaffId: staffId, amount: 4500, frequency: "monthly", payMethod: "bank", startDate: "2026-10-01", payTiming: "end" }).snapshot;
  assert.equal(getSalaryPayments(snapshot).length, 0);
  const status = describeSalarySchedule(snapshot, salaryArrangementForDriver(snapshot, staffId), "2026-10-28");
  assert.equal(status.next.period, "2026-10");
  assert.equal(status.next.scheduledAmount, 4500);
  // 3. Record the payment in Finance; a duplicate is refused.
  const payment = { driverStaffId: staffId, frequency: "monthly", period: "2026-10", paidDate: "2026-10-31", amount: 4500, method: "bank", source: "business_bank" };
  snapshot = act(snapshot, "salary.payment_record", payment).snapshot;
  assert.throws(() => act(snapshot, "salary.payment_record", payment), (e) => e.statusCode === 409);
  // 4. Reports: the salary is one expense, a driver salary, in no vehicle report.
  const business = buildPeriodReport(snapshot, { scope: "business", period: "monthly", month: "2026-10" });
  const lines = business.transactions.filter((line) => line.salary && line.driver === "Profile Flow Driver");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amountCents, 450000);
  assert.ok(business.totals.salaryCents >= 450000);
  assert.equal(business.reconciliation.ok, true);
  for (const vehicle of snapshot.vehicles ?? []) {
    const report = buildPeriodReport(snapshot, { scope: "vehicle", vehicleId: vehicle.id, period: "monthly", month: "2026-10" });
    assert.ok(!report.transactions.some((line) => line.salary), `${vehicle.id} holds no salary`);
  }
  const monthly = buildMonthlyExpenseReport(snapshot, "2026-10");
  assert.equal(monthly.lines.filter((line) => line.salary?.driverName === "Profile Flow Driver").length, 1);
});
