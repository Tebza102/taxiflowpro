import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import periodHandler from "../api/admin/reports/period.js";
import viewHandler from "../api/admin/daily-log/report-view.js";
import pdfHandler from "../api/admin/daily-log/report-pdf.js";
import { readDemoReportSnapshot } from "../api/_lib/reportSnapshot.js";
import { mockSnapshot } from "../src/data/mockData.js";
import { sanitizeDemoReportSnapshot } from "../src/lib/demoReportSnapshot.js";

// Demo Reports are built from the demo workspace as it is now (sent by the
// browser), so entries made in a demo session appear on screen, in the CSV and
// in the PDF alike. Live mode is untouched: it never accepts posted data.

const SESSION_EXPENSE = {
  id: "txn-session-1", type: "expense", expenseKind: "operational", category: "Session Test Cost",
  vehicleId: null, vehicle: "General", expenseDate: "2026-03-27", amount: 123.45, cashExpense: false, status: "verified",
  timestamp: "2026-03-27T10:00:00+02:00",
};
const sessionSnapshot = () => ({
  ...JSON.parse(JSON.stringify(mockSnapshot)),
  financeTransactions: [SESSION_EXPENSE, ...mockSnapshot.financeTransactions],
  appUsers: [{ id: "u1", name: "Demo Owner", email: "owner@taxiflow.local", accessPassword: "secret", role: "Owner" }],
  drivers: mockSnapshot.drivers.map((driver) => ({ ...driver, email: "x@example.com", accessPassword: "secret" })),
});

const call = async (handler, { method = "POST", query, body, parsed, headers = {} }) => {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = Object.assign(Readable.from(raw ? [Buffer.from(raw)] : []), { method, query, headers: { "content-type": "application/json", ...headers } });
  if (parsed !== undefined) req.body = parsed;
  const res = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(payload) { this.body = payload; } };
  await handler(req, res);
  return res;
};
const withNodeEnv = async (value, fn) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
};
const QUERY = { mode: "mock", scope: "business", period: "monthly", month: "2026-03" };

test("sanitising: only report fields are kept; passwords and emails never leave the browser", () => {
  const clean = sanitizeDemoReportSnapshot(sessionSnapshot());
  const json = JSON.stringify(clean);
  assert.ok(!json.includes("secret"));
  assert.ok(!json.includes("@"));
  assert.deepEqual(Object.keys(clean).sort(), ["appUsers", "dailyCashUps", "deposits", "drivers", "finance", "financeTransactions", "profile", "routes", "vehicles", "verificationQueue"]);
  assert.equal(clean.appUsers[0].name, "Demo Owner");
  assert.throws(() => readDemoReportSnapshot({ snapshot: { financeTransactions: "x" } }), (e) => e.statusCode === 400);
  assert.throws(() => readDemoReportSnapshot({}), (e) => e.statusCode === 400);
  assert.throws(() => readDemoReportSnapshot({ snapshot: { financeTransactions: new Array(20_001).fill({}) } }), (e) => e.statusCode === 413);
});

test("posted data is refused outside demo mode, and an unauthenticated demo request is refused in production", async () => {
  for (const mode of ["live", "auto", undefined]) {
    const res = await call(periodHandler, { query: { ...QUERY, mode }, body: { snapshot: sessionSnapshot() } });
    assert.equal(res.statusCode, 400, String(mode));
    assert.match(JSON.parse(res.body).error, /Only demo reports/);
  }
  await withNodeEnv("production", async () => {
    // A deployed server never builds a report from caller-supplied data.
    for (const handler of [periodHandler, viewHandler, pdfHandler]) {
      const res = await call(handler, { query: { ...QUERY, id: "txn-inc-1001" }, body: { snapshot: sessionSnapshot() } });
      assert.equal(res.statusCode, 403);
      assert.match(JSON.parse(res.body).error, /stored data only/);
    }
  });
});

test("a signed-in (business) request cannot post report data, so a demo flag never skips its checks", async () => {
  for (const handler of [periodHandler, viewHandler, pdfHandler]) {
    const res = await call(handler, { query: { ...QUERY, id: "txn-inc-1001" }, body: { snapshot: sessionSnapshot() }, headers: { authorization: "Bearer any-token" } });
    assert.equal(res.statusCode, 403);
    assert.match(JSON.parse(res.body).error, /signed-in business session/);
  }
});

test("payload shape and size are validated, including bodies the platform already parsed", async () => {
  const shape = await call(periodHandler, { query: QUERY, body: { snapshot: { financeTransactions: [1, "x"] } } });
  assert.equal(shape.statusCode, 400);
  assert.equal((await call(periodHandler, { query: QUERY, body: { snapshot: { profile: "x" } } })).statusCode, 400);
  assert.equal((await call(periodHandler, { query: QUERY, body: "not json" })).statusCode, 400);
  const big = JSON.stringify({ snapshot: { financeTransactions: [{ id: "x", note: "a".repeat(4_100_000) }] } });
  assert.equal((await call(periodHandler, { query: QUERY, body: big })).statusCode, 413);
  assert.equal((await call(periodHandler, { query: QUERY, parsed: JSON.parse(big) })).statusCode, 413);
  assert.equal((await call(periodHandler, { query: QUERY, body: { snapshot: {} }, headers: { "content-length": "5000000" } })).statusCode, 413);
});

test("people are reduced to ids, role and name; contact and credential fields never reach the report", () => {
  const clean = sanitizeDemoReportSnapshot({
    drivers: [{ staffId: "d1", name: "Sizwe", phone: "082", licenseNumber: "L1", prdpNumber: "P1", email: "s@x", accessPassword: "p" }],
    financeTransactions: [{ id: "t1", amount: 1, createdByEmail: "a@x", bankedAt: "2026-03-27", status: "banked" }],
  });
  assert.deepEqual(clean.drivers, [{ id: null, actorId: null, staffId: "d1", authUserId: null, role: null, name: "Sizwe" }]);
  assert.deepEqual(clean.financeTransactions, [{ id: "t1", amount: 1, bankedAt: "2026-03-27", status: "banked" }]);
});

test("a session entry appears consistently in the demo report's JSON, CSV and PDF", async () => {
  const body = { snapshot: sanitizeDemoReportSnapshot(sessionSnapshot()) };
  const json = JSON.parse((await call(periodHandler, { query: { ...QUERY, format: "json" }, body })).body);
  const line = json.transactions.find((item) => item.id === "txn-session-1");
  assert.ok(line, "the session expense is in the report");
  assert.equal(line.amountCents, 12345);
  assert.equal(json.reconciliation.ok, true);
  assert.ok(json.unallocatedBreakdown.some((group) => group.category === "Session Test Cost"));
  // The fixed demo data (GET) does not have it: the posted workspace is what changed.
  const fixed = JSON.parse((await call(periodHandler, { method: "GET", query: { ...QUERY, format: "json" } })).body);
  assert.equal(json.totals.expenseCents - fixed.totals.expenseCents, 12345);

  const csv = (await call(periodHandler, { query: { ...QUERY, format: "csv" }, body })).body.toString("utf8");
  assert.ok(csv.includes("Session Test Cost"));
  assert.ok(csv.includes(`Expenses,${(json.totals.expenseCents / 100).toFixed(2)}`));

  const pdf = await call(periodHandler, { query: { ...QUERY, format: "pdf" }, body });
  assert.equal(pdf.statusCode, 200);
  const text = (pdf.body.toString("latin1").match(/<[0-9a-fA-F]+>/g) ?? []).map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1")).join("");
  assert.ok(text.replace(/\s+/g, "").includes("SessionTestCost"));
  assert.ok(text.replace(/\s+/g, "").includes("DEMODATA"));
});

test("the daily cash report can be built for a cash-up that exists only in the demo session", async () => {
  const snapshot = sessionSnapshot();
  const income = { ...snapshot.financeTransactions.find((record) => record.type === "income" && record.incomeKind === "standard"), id: "txn-session-income", amountClaimed: 999, amount: 999 };
  snapshot.financeTransactions.unshift(income);
  const body = { snapshot: sanitizeDemoReportSnapshot(snapshot) };
  const view = await call(viewHandler, { query: { mode: "mock", id: "txn-session-income" }, body });
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(JSON.parse(view.body).reportId, "txn-session-income");
  const fixed = await call(viewHandler, { method: "GET", query: { mode: "mock", id: "txn-session-income" } });
  assert.equal(fixed.statusCode, 404);
  const pdf = await call(pdfHandler, { query: { mode: "mock", id: "txn-session-income" }, body });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.body.subarray(0, 5).toString("ascii"), "%PDF-");
  const live = await call(pdfHandler, { query: { mode: "live", id: "txn-session-income" }, body });
  assert.equal(live.statusCode, 400);
});

test("explicit allowlist: unlisted fields are dropped, and reports from the reduced data equal reports from the full data", async () => {
  const { buildDailyFinanceReportData } = await import("../api/_lib/dailyFinanceReport.js");
  const { buildPeriodReport } = await import("../src/lib/periodReport.js");
  const { DEMO_REPORT_FIELDS } = await import("../src/lib/demoReportSnapshot.js");
  const full = JSON.parse(JSON.stringify(mockSnapshot));
  full.financeTransactions[0] = { ...full.financeTransactions[0], unexpectedField: "x", idNumber: "8001015009087", nested: { secret: 1 } };
  full.vehicles[0] = { ...full.vehicles[0], ownerPhone: "082", insurer: "X" };
  const reduced = sanitizeDemoReportSnapshot(full);
  assert.equal(reduced.financeTransactions[0].unexpectedField, undefined);
  assert.equal(reduced.financeTransactions[0].idNumber, undefined);
  assert.equal(reduced.financeTransactions[0].nested, undefined);
  assert.equal(reduced.vehicles[0].ownerPhone, undefined);
  for (const [key, fields] of Object.entries(DEMO_REPORT_FIELDS)) {
    for (const item of reduced[key]) {
      for (const field of Object.keys(item)) {
        assert.ok(fields.includes(field) || ["tripLogbook", "editHistory", "salaryPayment", "settlement"].includes(field), `${key}.${field} is allowlisted`);
      }
    }
  }
  const strip = (report) => JSON.parse(JSON.stringify(report, (key, value) => (key === "generatedAt" || key === "generatedAtLabel" ? undefined : value)));
  const standard = full.financeTransactions.filter((record) => record.type === "income" && record.incomeKind === "standard");
  assert.ok(standard.length > 0);
  for (const record of standard) {
    assert.deepEqual(strip(buildDailyFinanceReportData(reduced, record.id)), strip(buildDailyFinanceReportData(full, record.id)), record.id);
  }
  const at = { generatedAt: "2026-03-28T08:00:00Z" };
  assert.deepEqual(buildPeriodReport(reduced, { scope: "business", period: "monthly", month: "2026-03" }, at), buildPeriodReport(full, { scope: "business", period: "monthly", month: "2026-03" }, at));
  for (const vehicle of full.vehicles) {
    const request = { scope: "vehicle", vehicleId: vehicle.id, period: "custom", start: "2026-03-01", end: "2026-03-31" };
    assert.deepEqual(buildPeriodReport(reduced, request, at), buildPeriodReport(full, request, at), vehicle.id);
  }
});
