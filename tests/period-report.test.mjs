import assert from "node:assert/strict";
import test from "node:test";

import handler, { resolvePeriodReport } from "../api/admin/reports/period.js";
import { renderPeriodReportPdf } from "../api/_lib/periodReportPdf.js";
import { normalizeModuleViewAccess } from "../src/lib/moduleAccessPolicy.js";
import {
  buildBusinessReport,
  buildPeriodReport,
  buildVehicleReport,
  periodReportCsv,
  reportDateOf,
  resolveReportPeriod,
} from "../src/lib/periodReport.js";

// Business and vehicle period reports: calculations, date boundaries,
// allocation, permissions and the CSV/PDF exports (src/lib/periodReport.js,
// api/admin/reports/period.js, api/_lib/periodReportPdf.js).

const income = (id, vehicleId, vehicle, tripDate, amount, extra = {}) => ({
  id, type: "income", incomeKind: "standard", vehicleId, vehicle, tripDate, amountClaimed: amount, amount, status: "verified", timestamp: `${tripDate}T08:00:00+02:00`, ...extra,
});
const expense = (id, vehicleId, vehicle, expenseDate, amount, extra = {}) => ({
  id, type: "expense", expenseKind: "operational", category: "Fuel", vehicleId, vehicle, expenseDate, amount, cashExpense: true, status: "verified", timestamp: `${expenseDate}T09:00:00+02:00`, ...extra,
});

const fixture = () => ({
  profile: { fleetName: "Test Fleet" },
  vehicles: [
    { id: "veh-a", registration: "AAA 111 GP", model: "Quantum", route: "A to B", status: "active", assignedDriverId: "drv-1" },
    { id: "veh-b", registration: "BBB 222 GP", model: "Ses'fikile", route: "C to D", status: "active" },
  ],
  drivers: [{ staffId: "drv-1", name: "Sizwe Mokoena" }, { staffId: "drv-2", name: "Thandi Nkosi" }],
  financeTransactions: [
    income("inc-a1", "veh-a", "AAA 111 GP", "2026-03-02", 1000.1, { driverStaffId: "drv-1", route: "A to B", openingOdo: 1000, closingOdo: 1120 }),
    income("inc-a2", "veh-a", "AAA 111 GP", "2026-03-31", 500.2, { driverStaffId: "drv-1", status: "pending" }),
    income("inc-a3", "veh-a", "AAA 111 GP", "2026-04-01", 999, { driverStaffId: "drv-1" }), // outside March
    { ...income("inc-b1", null, "BBB 222 GP", "2026-03-15", 700, { createdBy: "drv-2", createdByRole: "Driver" }), incomeKind: "special" }, // by registration only
    expense("exp-a1", "veh-a", "AAA 111 GP", "2026-03-02", 300.3),
    expense("exp-b1", "veh-b", "BBB 222 GP", "2026-03-15", 200, { category: "Repairs", cashExpense: false }),
    // A business expense without a vehicle.
    expense("exp-gen", null, "General", "2026-03-10", 450.45, { category: "Rank Fees" }),
    // A driver salary paid by bank (never a vehicle cost).
    expense("txn-salary-drv-1-monthly-2026-03", null, null, "2026-03-31", 3000, {
      category: "Salary", cashExpense: false, driverStaffId: null,
      salaryPayment: { driverStaffId: "drv-1", driverName: "Sizwe Mokoena", frequency: "monthly", period: "2026-03", periodLabel: "March 2026", method: "bank", source: "business_bank" },
    }),
  ],
  dailyCashUps: [
    { id: "cu-1", driverStaffId: "drv-1", driverName: "Sizwe Mokoena", workDate: "2026-03-02", expectedCashIn: 699.8, actualCashReceived: 690, status: "verified" },
    { id: "cu-2", driverStaffId: "drv-1", driverName: "Sizwe Mokoena", workDate: "2026-03-31", expectedCashIn: 500.2, actualCashReceived: null, status: "pending" },
    { id: "cu-3", driverStaffId: "drv-1", driverName: "Sizwe Mokoena", workDate: "2026-04-01", expectedCashIn: 999, actualCashReceived: 999, status: "counted" },
  ],
  deposits: [
    { depositId: "dep-1", reference: "TFP-1", timestamp: "2026-03-03T14:00:00+02:00", recordsLocked: 2, verifiedTakings: 1000.1, cashExpenses: 300.3, depositAmount: 690 },
    // 23:30 UTC on 31 March is 1 April in South Africa: outside March.
    { depositId: "dep-2", reference: "TFP-2", timestamp: "2026-03-31T23:30:00Z", recordsLocked: 1, verifiedTakings: 10, cashExpenses: 0, depositAmount: 10 },
  ],
});

const MARCH = { period: "monthly", month: "2026-03" };

test("periods: daily, Monday-to-Sunday weeks across a year end, calendar months (leap year) and inclusive custom ranges", () => {
  assert.deepEqual(pick(resolveReportPeriod({ period: "daily", date: "2026-03-27" })), ["2026-03-27", "2026-03-27", 1]);
  assert.deepEqual(pick(resolveReportPeriod({ period: "weekly", date: "2026-01-01" })), ["2025-12-29", "2026-01-04", 7]);
  assert.deepEqual(pick(resolveReportPeriod({ period: "weekly", date: "2026-03-29" })), ["2026-03-23", "2026-03-29", 7]); // a Sunday
  assert.deepEqual(pick(resolveReportPeriod({ period: "monthly", month: "2028-02" })), ["2028-02-01", "2028-02-29", 29]);
  assert.deepEqual(pick(resolveReportPeriod({ period: "monthly", date: "2026-12-15" })), ["2026-12-01", "2026-12-31", 31]);
  assert.deepEqual(pick(resolveReportPeriod({ period: "custom", start: "2026-03-30", end: "2026-04-02" })), ["2026-03-30", "2026-04-02", 4]);
});
const pick = (period) => [period.start, period.end, period.days];

test("periods: invalid, reversed and over-long requests are refused with 400", () => {
  for (const input of [
    { period: "daily", date: "2026-02-30" },
    { period: "hourly", date: "2026-03-01" },
    { period: "custom", start: "2026-03-10", end: "2026-03-01" },
    { period: "custom", start: "2020-01-01", end: "2026-01-01" },
    { period: "monthly", month: "2026-13" },
  ]) {
    assert.throws(() => resolveReportPeriod(input), (error) => error.statusCode === 400, JSON.stringify(input));
  }
});

test("date boundaries: first and last day are included, the next day is not; capture time falls back to South African date", () => {
  const report = buildBusinessReport(fixture(), MARCH);
  const ids = report.transactions.map((line) => line.id);
  assert.ok(ids.includes("inc-a1") && ids.includes("inc-a2"), "1 and 31 March included");
  assert.ok(!ids.includes("inc-a3"), "1 April excluded");

  // No operating date: 31 Mar 22:30 UTC is 1 Apr 00:30 SAST; 31 Mar 21:59 UTC is still 31 Mar.
  assert.deepEqual(reportDateOf({ type: "income", timestamp: "2026-03-31T22:30:00Z" }), { date: "2026-04-01", fromTimestamp: true });
  assert.deepEqual(reportDateOf({ type: "income", timestamp: "2026-03-31T21:59:00Z" }), { date: "2026-03-31", fromTimestamp: true });
  const snapshot = fixture();
  snapshot.financeTransactions.push(
    { id: "late", type: "income", incomeKind: "standard", vehicleId: "veh-a", amount: 5, timestamp: "2026-03-31T22:30:00Z" },
    { id: "edge", type: "income", incomeKind: "standard", vehicleId: "veh-a", amount: 7, timestamp: "2026-03-31T21:59:00Z" },
    { id: "nodate", type: "expense", amount: 9 },
  );
  const march = buildBusinessReport(snapshot, MARCH);
  assert.ok(march.transactions.some((line) => line.id === "edge" && line.dateFromTimestamp));
  assert.ok(!march.transactions.some((line) => line.id === "late"));
  assert.ok(march.notes.some((note) => /1 entry has no operating date/.test(note)));
  assert.ok(march.notes.some((note) => /1 entry has no date at all/.test(note)));
  assert.ok(buildBusinessReport(snapshot, { period: "daily", date: "2026-04-01" }).transactions.some((line) => line.id === "late"));
});

test("business report: income, expenses, salaries and net reconcile in cents", () => {
  const report = buildBusinessReport(fixture(), MARCH);
  const t = report.totals;
  assert.equal(t.incomeCents, 100010 + 50020 + 70000);
  assert.equal(t.specialIncomeCents, 70000);
  assert.equal(t.expenseCents, 30030 + 20000 + 45045 + 300000);
  assert.equal(t.salaryCents, 300000);
  assert.equal(t.vehicleExpenseCents, 50030);
  assert.equal(t.unallocatedCents, 45045);
  assert.equal(t.netCents, t.incomeCents - t.expenseCents);
  assert.equal(report.netLabel, "Net result (recorded income less recorded expenses)");
  assert.ok(!/profit/i.test(report.netLabel));
  assert.ok(report.notes[0].includes("not accounting profit"));
  assert.equal(report.reconciliation.ok, true);
  assert.equal(report.reconciliation.checks.length, 4);
  // Vehicle results less unallocated costs and salaries equal the business net.
  const vehicleNet = report.vehicles.reduce((total, row) => total + row.netCents, 0);
  assert.equal(vehicleNet - t.unallocatedCents - t.salaryCents, t.netCents);
  assert.deepEqual(report.salaries.map((line) => line.amountCents), [300000]);
  assert.equal(report.businessName, null);
  assert.deepEqual(report.expenseBreakdown.map((group) => group.category), ["Salary", "Rank Fees", "Fuel", "Repairs"]);
});

test("a business expense without a vehicle is counted once in the business report and in no vehicle report", () => {
  const snapshot = fixture();
  const business = buildBusinessReport(snapshot, MARCH);
  assert.equal(business.transactions.filter((line) => line.id === "exp-gen").length, 1);
  assert.equal(business.unallocatedBreakdown.reduce((total, group) => total + group.amountCents, 0), 45045);
  assert.ok(!business.vehicles.some((row) => row.expenseCents === 45045));
  for (const vehicle of snapshot.vehicles) {
    const report = buildVehicleReport(snapshot, resolveReportPeriod(MARCH), vehicle.id);
    assert.ok(!report.transactions.some((line) => line.id === "exp-gen"), `${vehicle.id} excludes the business expense`);
    assert.ok(!report.transactions.some((line) => line.id.startsWith("txn-salary")), `${vehicle.id} excludes salaries`);
  }
  // Vehicle expenses + unallocated + salaries cover every expense exactly once.
  const vehicleExpense = snapshot.vehicles.reduce((total, vehicle) => total + buildVehicleReport(snapshot, resolveReportPeriod(MARCH), vehicle.id).totals.expenseCents, 0);
  assert.equal(vehicleExpense + business.totals.unallocatedCents + business.totals.salaryCents, business.totals.expenseCents);
});

test("vehicle report: identity, own income and expenses, activity, linked drivers", () => {
  const a = buildPeriodReport(fixture(), { scope: "vehicle", vehicleId: "veh-a", ...MARCH });
  assert.equal(a.vehicle.registration, "AAA 111 GP");
  assert.equal(a.vehicle.assignedDriver, "Sizwe Mokoena");
  assert.equal(a.totals.incomeCents, 150030);
  assert.equal(a.totals.expenseCents, 30030);
  assert.equal(a.totals.netCents, 120000);
  assert.equal(a.activity.trips, 2);
  assert.equal(a.activity.distanceKm, 120);
  assert.equal(a.activity.tripsWithDistance, 1);
  assert.deepEqual(a.activity.drivers, ["Sizwe Mokoena"]);
  assert.ok(a.notes.some((note) => /not allocated to vehicles/.test(note)));
  assert.equal(a.reconciliation.ok, true);

  // A record naming the vehicle only by registration still belongs to it.
  const b = buildPeriodReport(fixture(), { scope: "vehicle", vehicleId: "veh-b", ...MARCH });
  assert.equal(b.totals.specialIncomeCents, 70000);
  assert.equal(b.activity.specialHires, 1);
  assert.deepEqual(b.activity.drivers, ["Thandi Nkosi"]);
  assert.throws(() => buildPeriodReport(fixture(), { scope: "vehicle", vehicleId: "veh-x", ...MARCH }), (error) => error.statusCode === 404);
});

test("cash checking and banking summaries use the selected dates (deposits by South African date)", () => {
  const { cashChecking, banking } = buildBusinessReport(fixture(), MARCH);
  assert.equal(cashChecking.dayCount, 2);
  assert.equal(cashChecking.awaitingCount, 1);
  assert.equal(cashChecking.expectedCents, 69980 + 50020);
  assert.equal(cashChecking.countedCents, 69000);
  assert.equal(cashChecking.shortCents, 980);
  assert.equal(cashChecking.overCents, 0);
  assert.deepEqual(banking.deposits.map((deposit) => deposit.reference), ["TFP-1"]);
  assert.equal(banking.depositCents, 69000);
});

test("legacy Salary-category expenses are disclosed and not counted as driver salaries", () => {
  const snapshot = fixture();
  snapshot.financeTransactions.push(expense("old-sal", null, "General", "2026-03-05", 100, { category: "Salary" }));
  const report = buildBusinessReport(snapshot, MARCH);
  assert.equal(report.totals.salaryCents, 300000);
  assert.equal(report.totals.unallocatedCents, 45045 + 10000);
  assert.ok(report.notes.some((note) => /recorded without a driver salary payment/.test(note)));
});

test("CSV carries the same figures as the report, keeps amounts numeric and neutralises formulas", () => {
  const snapshot = fixture();
  snapshot.financeTransactions.push(expense("evil", null, "General", "2026-03-11", 1, { category: "Other", description: "=HYPERLINK(\"x\")" }));
  const report = buildBusinessReport(snapshot, MARCH, { generatedAt: "2026-04-01T08:00:00Z", businessName: "Test Fleet" });
  const csv = periodReportCsv(report);
  const rows = csv.split("\r\n");
  const value = (label) => rows.find((row) => row.startsWith(`${label},`))?.split(",").at(-1);
  assert.equal(value("Income"), (report.totals.incomeCents / 100).toFixed(2));
  assert.equal(value("Expenses"), (report.totals.expenseCents / 100).toFixed(2));
  assert.equal(value("  Business costs without a vehicle"), (report.totals.unallocatedCents / 100).toFixed(2));
  assert.equal(value(report.netLabel), (report.totals.netCents / 100).toFixed(2));
  assert.ok(rows.includes("Generated,\"1 Apr 2026, 10:00 SAST\""));
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"x\"\")\""), "formula prefixed");
  assert.ok(rows.some((row) => row === "Reconciles,yes"));
  // Every transaction appears exactly once, and the transaction lines add up.
  const header = rows.findIndex((row) => row.startsWith("Date,Type,Category"));
  const lines = rows.slice(header + 1, header + 1 + report.transactions.length);
  const cents = (row) => Math.round(Number(row.split(",").at(-1)) * 100);
  assert.equal(lines.filter((row) => row.includes(",Income,")).reduce((total, row) => total + cents(row), 0), report.totals.incomeCents);
  assert.equal(lines.filter((row) => row.includes(",Expense,")).reduce((total, row) => total + cents(row), 0), report.totals.expenseCents);
});

const requester = (role, moduleAccess = {}) => ({ id: `u-${role}`, role, moduleAccess: normalizeModuleViewAccess(moduleAccess, role) });

test("permissions: Owner, and Admin/Manager with Money on, may build reports; everyone else is refused", () => {
  const snapshotResult = (requestedBy, source = "live") => ({ source, snapshot: fixture(), requestedBy });
  for (const role of ["Owner", "Admin", "Manager"]) {
    assert.equal(resolvePeriodReport(snapshotResult(requester(role)), { scope: "business", ...MARCH }).kind, "business");
  }
  for (const role of ["Driver", "Viewer"]) {
    assert.throws(() => resolvePeriodReport(snapshotResult(requester(role, { finance: true })), { scope: "business", ...MARCH }), (error) => error.statusCode === 403);
  }
  for (const role of ["Admin", "Manager"]) {
    assert.throws(() => resolvePeriodReport(snapshotResult(requester(role, { finance: false })), { scope: "business", ...MARCH }), (error) => error.statusCode === 403);
  }
  assert.throws(() => resolvePeriodReport(snapshotResult(null), { scope: "vehicle", vehicleId: "veh-a", ...MARCH }), (error) => error.statusCode === 401);
  // Access is checked before the request is read: a refused caller learns nothing about vehicles.
  assert.throws(() => resolvePeriodReport(snapshotResult(requester("Driver")), { scope: "vehicle", vehicleId: "veh-x", ...MARCH }), (error) => error.statusCode === 403);
});

const call = async (query, headers = {}) => {
  const res = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(body) { this.body = body; } };
  await handler({ method: "GET", query, headers }, res);
  return res;
};

test("HTTP: a live request without a session is 401 in every format; bad input is 400", async () => {
  for (const format of ["json", "csv", "pdf"]) {
    const res = await call({ mode: "live", scope: "business", period: "monthly", month: "2026-03", format });
    assert.equal(res.statusCode, 401, format);
    assert.match(res.headers["content-type"], /application\/json/);
  }
  assert.equal((await call({ mode: "mock", format: "xml", period: "daily", date: "2026-03-27" })).statusCode, 400);
  const reversed = await call({ mode: "mock", period: "custom", start: "2026-03-10", end: "2026-03-01" });
  assert.equal(reversed.statusCode, 400);
  assert.match(JSON.parse(reversed.body).error, /start date/);
});

test("HTTP: demo JSON, CSV and PDF for the same filters agree", async () => {
  const query = { mode: "mock", scope: "business", period: "monthly", month: "2026-03" };
  const json = JSON.parse((await call({ ...query, format: "json" })).body);
  const csv = (await call({ ...query, format: "csv" })).body.toString("utf8");
  const pdf = await call({ ...query, format: "pdf" });
  assert.equal(json.meta.source, "mock");
  assert.ok(csv.includes(`Income,${(json.totals.incomeCents / 100).toFixed(2)}`));
  assert.match(pdf.headers["content-disposition"], /taxiflow-business-2026-03-01-to-2026-03-31\.pdf/);
  assert.equal(pdf.body.subarray(0, 5).toString("ascii"), "%PDF-");
});

const pdfText = (buffer) =>
  (buffer.toString("latin1").match(/<[0-9a-fA-F]+>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1"))
    .join("");

test("PDF: A4, marked DEMO DATA for demo, shows the selected scope, dates and the same net result", async () => {
  const report = buildBusinessReport(fixture(), MARCH, { generatedAt: "2026-04-01T08:00:00Z" });
  const live = await renderPeriodReportPdf(report, { source: "live" });
  const demo = await renderPeriodReportPdf(report, { source: "mock" });
  assert.match(live.toString("latin1"), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const text = pdfText(live).replace(/\s+/g, "");
  assert.ok(text.includes("Overallbusiness"));
  assert.ok(text.includes("1Mar2026to31Mar2026"));
  assert.ok(text.includes("Netresult(recordedincomelessrecordedexpenses)"));
  assert.ok(text.includes("-R1750,45"), "net result"); // 2200.30 - 3950.75, en-ZA format
  assert.ok(!text.includes("DEMODATA"));
  assert.ok(pdfText(demo).replace(/\s+/g, "").includes("DEMODATA"));
  const vehicle = await renderPeriodReportPdf(buildVehicleReport(fixture(), resolveReportPeriod(MARCH), "veh-a"), { source: "live" });
  assert.ok(pdfText(vehicle).replace(/\s+/g, "").includes("AAA111GP"));
});
