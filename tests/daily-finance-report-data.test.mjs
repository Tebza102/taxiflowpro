import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyFinanceReportData } from "../api/_lib/dailyFinanceReport.js";
import { mockSnapshot } from "../src/data/mockData.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const standaloneSnapshot = () => ({
  vehicles: [{ id: "veh-1", registration: "TEST 100 GP", model: "Toyota Quantum", seatCapacity: 16 }],
  drivers: [
    { staffId: "drv-1", name: "Test Driver", role: "Driver" },
    { staffId: "adm-1", name: "Thandi Admin", role: "Admin" },
  ],
  appUsers: [{ id: "boss@example.com", email: "boss@example.com", name: "boss@example.com", actorId: "auth-1" }],
  financeTransactions: [
    {
      id: "daily-1",
      type: "income",
      incomeKind: "standard",
      vehicleId: "veh-1",
      vehicle: "TEST 100 GP",
      route: "Point A to Point B",
      tripDate: "2026-04-05",
      amountClaimed: 140,
      actualCashReceived: 130,
      status: "counted",
      createdBy: "adm-1",
      createdByRole: "Admin",
      createdAt: "2026-04-05T17:00:00+02:00",
      countedAt: "2026-04-05T18:00:00+02:00",
      countedBy: "auth-1",
      countedByRole: "Owner",
    },
    {
      id: "expense-1",
      type: "expense",
      category: "Fuel",
      amount: 30,
      cashExpense: true,
      vehicleId: "veh-1",
      expenseDate: "2026-04-05",
    },
    {
      id: "special-1",
      type: "income",
      incomeKind: "special",
      vehicleId: "veh-1",
      tripDate: "2026-04-05",
      amountClaimed: 50,
    },
  ],
  dailyCashUps: [],
  deposits: [],
});

const driverDaySnapshot = () => ({
  vehicles: [{ id: "veh-1", registration: "TEST 100 GP" }],
  drivers: [
    { staffId: "drv-1", name: "Test Driver", role: "Driver" },
    { staffId: "mgr-1", name: "Lerato Manager", role: "Manager" },
  ],
  financeTransactions: [
    {
      id: "day-std",
      type: "income",
      incomeKind: "standard",
      vehicleId: "veh-1",
      vehicle: "TEST 100 GP",
      tripDate: "2026-09-20",
      amountClaimed: 1000,
      status: "verified",
      createdBy: "drv-1",
      createdByRole: "Driver",
      driverStaffId: "drv-1",
    },
    {
      id: "day-special",
      type: "income",
      incomeKind: "special",
      tripDate: "2026-09-20",
      amountClaimed: 300,
      status: "verified",
      createdByRole: "Driver",
      driverStaffId: "drv-1",
    },
    {
      id: "day-fuel-cash",
      type: "expense",
      amount: 200,
      cashExpense: true,
      expenseDate: "2026-09-20",
      status: "verified",
      createdByRole: "Driver",
      driverStaffId: "drv-1",
    },
    {
      id: "day-repair-card",
      type: "expense",
      amount: 450,
      cashExpense: false,
      expenseDate: "2026-09-20",
      status: "verified",
      createdByRole: "Driver",
      driverStaffId: "drv-1",
    },
  ],
  dailyCashUps: [
    {
      id: "cu-1",
      driverStaffId: "drv-1",
      workDate: "2026-09-20",
      status: "verified",
      actualCashReceived: 1050,
      createdAt: "2026-09-20T19:30:00+02:00",
      countedAt: "2026-09-20T20:00:00+02:00",
      countedByRole: "Admin",
      verifiedAt: "2026-09-20T21:00:00+02:00",
      verifiedBy: "mgr-1",
      verifiedByRole: "Manager",
    },
  ],
  deposits: [],
});

test("standalone record: expected and actual match the queue's claimed/counted, nothing netted", () => {
  const report = buildDailyFinanceReportData(standaloneSnapshot(), "daily-1");

  assert.equal(report.cashUp.basis, "standalone");
  assert.equal(report.cashUp.expectedCashHandIn, 140);
  assert.equal(report.cashUp.actualCashReceived, 130);
  assert.equal(report.cashUp.cashVariance, -10);
  assert.equal(report.cashUp.standardIncome, 140);
  assert.equal(report.cashUp.specialIncome, 50);
  assert.equal(report.cashUp.specialIncomeIncluded, false);
  assert.equal(report.cashUp.totalExpenses, 30);
  assert.equal(report.cashUp.cashExpensesNetted, false);
});

test("driver day cash-up: expected = all day income less cash expenses only", () => {
  const report = buildDailyFinanceReportData(driverDaySnapshot(), "day-std");

  assert.equal(report.cashUp.basis, "driver-day");
  assert.equal(report.cashUp.standardIncome, 1000);
  assert.equal(report.cashUp.specialIncome, 300);
  assert.equal(report.cashUp.specialIncomeIncluded, true);
  assert.equal(report.cashUp.totalExpenses, 650);
  assert.equal(report.cashUp.cashExpenses, 200);
  assert.equal(report.cashUp.nonCashExpenses, 450);
  assert.equal(report.cashUp.expectedCashHandIn, 1100);
  assert.equal(report.cashUp.actualCashReceived, 1050);
  assert.equal(report.cashUp.cashVariance, -50);
  assert.equal(report.cashUp.status, "verified");
});

test("cash variance is signed actual - expected: short is negative, over is positive", () => {
  const short = driverDaySnapshot();
  short.dailyCashUps[0].actualCashReceived = 1080;
  const shortReport = buildDailyFinanceReportData(short, "day-std");
  assert.equal(shortReport.cashUp.expectedCashHandIn, 1100);
  assert.equal(shortReport.cashUp.cashVariance, -20);

  const over = driverDaySnapshot();
  over.dailyCashUps[0].actualCashReceived = 1130;
  assert.equal(buildDailyFinanceReportData(over, "day-std").cashUp.cashVariance, 30);
});

test("driver day record with no submitted cash-up awaits count and is not marked submitted", () => {
  const snapshot = driverDaySnapshot();
  snapshot.dailyCashUps = [];
  snapshot.financeTransactions.forEach((record) => {
    record.status = "pending";
  });

  const report = buildDailyFinanceReportData(snapshot, "day-std");

  assert.equal(report.cashUp.actualCashReceived, null);
  assert.equal(report.cashUp.cashVariance, null);
  assert.equal(report.stages.find((stage) => stage.stage === "pending").reached, false);
  assert.ok(report.stages.every((stage) => stage.reached === false));
});

test("workflow stages beyond the current status are never marked complete", () => {
  const report = buildDailyFinanceReportData(standaloneSnapshot(), "daily-1");

  assert.deepEqual(
    report.stages.map((stage) => [stage.stage, stage.reached]),
    [["pending", true], ["counted", true], ["verified", false], ["banked", false]],
  );
  assert.equal(report.stages[2].at, null);
  assert.equal(report.stages[2].by, null);
});

test("reviewer names resolve from staff records, and email-only names are never printed", () => {
  const dayReport = buildDailyFinanceReportData(driverDaySnapshot(), "day-std");
  assert.equal(dayReport.stages[2].by, "Lerato Manager (Manager)");
  assert.equal(dayReport.stages[1].by, "Admin");

  const standaloneReport = buildDailyFinanceReportData(standaloneSnapshot(), "daily-1");
  assert.equal(standaloneReport.stages[1].by, "Owner");
  assert.equal(standaloneReport.capturedBy, "Thandi Admin (Admin)");
});

test("missing amounts are reported as not recorded rather than zero", () => {
  const snapshot = standaloneSnapshot();
  delete snapshot.financeTransactions[0].amountClaimed;
  snapshot.financeTransactions[0].actualCashReceived = null;

  const report = buildDailyFinanceReportData(snapshot, "daily-1");

  assert.equal(report.cashUp.expectedCashHandIn, null);
  assert.equal(report.cashUp.cashVariance, null);
  assert.equal(report.capturedBy, "Thandi Admin (Admin)");
});

test("driver is never taken from an Admin creator or guessed from the route", () => {
  const snapshot = standaloneSnapshot();
  snapshot.drivers[0].route = "Point A to Point B";

  assert.equal(buildDailyFinanceReportData(snapshot, "daily-1").header.driver, null);

  snapshot.financeTransactions[0].driverStaffId = "drv-1";
  assert.equal(buildDailyFinanceReportData(snapshot, "daily-1").header.driver, "Test Driver");
});

test("a record without a driver gets the same driver the app shows (vehicle's assigned driver)", () => {
  const snapshot = standaloneSnapshot();
  snapshot.vehicles[0].assignedDriverId = "drv-1";

  assert.equal(buildDailyFinanceReportData(snapshot, "daily-1").header.driver, "Test Driver");
});

test("captured-by is null when the record does not say who captured it", () => {
  const snapshot = standaloneSnapshot();
  snapshot.financeTransactions[0].createdBy = null;
  snapshot.financeTransactions[0].createdByRole = null;

  assert.equal(buildDailyFinanceReportData(snapshot, "daily-1").capturedBy, null);
});

test("banked seed record links its deposit batch", () => {
  const report = buildDailyFinanceReportData(clone(mockSnapshot), "txn-inc-0901");

  assert.equal(report.cashUp.status, "banked");
  assert.deepEqual(report.deposit, {
    depositId: "dep-0326-02",
    reference: "TFP-THU-0326",
    batchAmount: report.deposit.batchAmount,
    recordsInBatch: 5,
    depositedAt: "2026-03-26T16:25:00+02:00",
  });
  assert.ok(Number.isFinite(report.deposit.batchAmount));
  assert.ok(report.stages.every((stage) => stage.reached));
});

test("no deposit block without a linked deposit", () => {
  assert.equal(buildDailyFinanceReportData(standaloneSnapshot(), "daily-1").deposit, null);
});

test("an unknown record id is a 404", () => {
  assert.throws(
    () => buildDailyFinanceReportData(standaloneSnapshot(), "does-not-exist"),
    (error) => error.statusCode === 404,
  );
});

test("building a report never mutates the snapshot", () => {
  const snapshot = driverDaySnapshot();
  const before = JSON.stringify(snapshot);

  buildDailyFinanceReportData(snapshot, "day-std");

  assert.equal(JSON.stringify(snapshot), before);
});
