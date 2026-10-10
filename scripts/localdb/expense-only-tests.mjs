#!/usr/bin/env node
// Expense-only / negative driver days on the LOCAL stack with real local Auth.
// Requires a fresh `node scripts/localdb/setup.mjs reset`.
// Examples (decision-pack section 3): A normal, B expense-only cash, C cash
// expenses above takings, D expense-only non-cash. Proves: cash to hand in and
// uncovered cash expenses are separate; variance stays signed (counted −
// expected); zero-cash days close at verified with an explicit indicator (status
// contract unchanged), are locked, cannot be re-submitted, and are never banked;
// no R 0 deposit is created.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;
const { default: handler } = await import("../../api/business/finance-actions.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (t) => psql(t).stdout.trim();
const version = () => sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${BUSINESS_A_ID}';`);
const snapshot = () => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${BUSINESS_A_ID}';`));
const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return data.session.access_token;
};
const post = async (token, action, fields) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${token}` }, query: { business: BUSINESS_A_ID }, body: { action, requestId: randomUUID(), expectedVersion: version(), fields } }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* */ }
  return { status: res.statusCode, json };
};

const driver = await tokenFor("driver@example.com");
const admin = await tokenFor("admin@example.com");
const manager = await tokenFor("manager@example.com");
const STAFF = "uat-drv-01";
const cashUpId = (date) => `cashup-${STAFF}-${date}`;
const expense = (date, amount, cash, description) => post(driver, "capture.expense", { expenseKind: "operational", category: "Fuel", description, expenseDate: date, amount, cashExpense: cash });
const trip = (date, amount, odo) => post(driver, "capture.standard_income", {
  vehicleId: "uat-veh-01", tripDate: date, timeIn: "06:00", timeOut: "08:00", openingOdo: odo, closingOdo: odo + 40,
  tripLogbook: [{ fromLocation: "Rank A", toLocation: "Rank B", passengerCount: 5, amountCollected: amount }],
});
const cashUp = (date) => (snapshot().dailyCashUps ?? []).find((entry) => entry.id === cashUpId(date));
const recordsOf = (date) => (snapshot().financeTransactions ?? []).filter((t) => t.driverStaffId === STAFF && (t.tripDate === date || t.expenseDate === date));

const DAYS = {
  A: { date: "2026-10-11", label: "A normal", income: 500, cash: 120, cashFlag: true },
  B: { date: "2026-10-12", label: "B expense-only cash", income: 0, cash: 200, cashFlag: true },
  C: { date: "2026-10-13", label: "C cash expenses above takings", income: 100, cash: 300, cashFlag: true },
  D: { date: "2026-10-14", label: "D expense-only non-cash", income: 0, cash: 900, cashFlag: false },
};
const expected = {
  A: { expectedCashIn: 380, cashToHandIn: 380, uncovered: 0, counted: 380, variance: 0, closed: false },
  B: { expectedCashIn: -200, cashToHandIn: 0, uncovered: 200, counted: 0, variance: 200, closed: true },
  C: { expectedCashIn: -200, cashToHandIn: 0, uncovered: 200, counted: 0, variance: 200, closed: true },
  D: { expectedCashIn: 0, cashToHandIn: 0, uncovered: 0, counted: 0, variance: 0, closed: true },
};

let odo = 1100;
for (const [key, day] of Object.entries(DAYS)) {
  if (day.income) {
    const r = await trip(day.date, day.income, odo);
    odo += 40;
    record(r.status === 200, `${day.label}: trip captured`, r.json.error);
  }
  const e = await expense(day.date, day.cash, day.cashFlag, `${day.label} expense`);
  record(e.status === 200, `${day.label}: expense captured`, e.json.error);
  const s = await post(driver, "cashup.submit", { workDate: day.date });
  const stored = cashUp(day.date);
  record(
    s.status === 200 && stored?.expectedCashIn === expected[key].expectedCashIn && stored.cashToHandIn === expected[key].cashToHandIn && stored.uncoveredCashExpenses === expected[key].uncovered,
    `${day.label}: submitted; expected ${expected[key].expectedCashIn}, to hand in ${expected[key].cashToHandIn}, uncovered ${expected[key].uncovered}`,
    `${s.status} ${s.json.error ?? ""} ${stored ? `${stored.expectedCashIn}/${stored.cashToHandIn}/${stored.uncoveredCashExpenses}` : "no cash-up"}`,
  );
  const h = await post(admin, "cashup.record_handin", { cashUpId: cashUpId(day.date), actualCashReceived: expected[key].counted });
  record(h.status === 200 && h.json.status === "counted", `${day.label}: hand-in R ${expected[key].counted} recorded`, `${h.status} ${h.json.error ?? ""}`);
  const again = await post(driver, "cashup.submit", { workDate: day.date });
  record(again.status === 409 && cashUp(day.date).status === "counted", `${day.label}: a counted day cannot be re-submitted (no reopening)`, `${again.status} ${again.json.error ?? ""}`);
  const v = await post(manager, "cashup.verify", { cashUpId: cashUpId(day.date) });
  const after = cashUp(day.date);
  record(
    v.status === 200 && v.json.variance === expected[key].variance && v.json.cashToHandIn === expected[key].cashToHandIn && v.json.uncoveredCashExpenses === expected[key].uncovered && v.json.closedWithoutDeposit === expected[key].closed,
    `${day.label}: verified; signed variance ${expected[key].variance >= 0 ? "+" : ""}${expected[key].variance}; closed without deposit = ${expected[key].closed}`,
    `${v.status} variance=${v.json.variance} closed=${v.json.closedWithoutDeposit} ${v.json.error ?? ""}`,
  );
  record(
    after.status === "verified" && Boolean(after.settlement?.closedWithoutDeposit) === expected[key].closed && recordsOf(day.date).every((t) => t.status === "verified"),
    `${day.label}: status stays "verified" (contract unchanged); indicator ${expected[key].closed ? "set" : "absent"}`,
    `${after.status} ${JSON.stringify(after.settlement)}`,
  );
}

// Closed days are locked: no new work, no re-submit.
let r = await expense(DAYS.B.date, 10, true, "late expense");
record(r.status === 409, "a closed zero-cash day refuses new work", `${r.status} ${r.json.error ?? ""}`);
r = await post(driver, "cashup.submit", { workDate: DAYS.B.date });
record(r.status === 409 && cashUp(DAYS.B.date).settlement?.closedWithoutDeposit === true, "a closed zero-cash day cannot be re-submitted", `${r.status}`);

// Banking: only day A (and the seeded standalone verified record) are bankable.
const snap = snapshot();
const verifiedLinked = new Set(Object.values(DAYS).flatMap((day) => recordsOf(day.date).map((t) => t.id)));
const dayATransactions = recordsOf(DAYS.A.date).map((t) => t.id);
const standalone = snap.financeTransactions.filter((t) => t.status === "verified" && !verifiedLinked.has(t.id)).map((t) => t.id);
const batch = { cashUpIds: [cashUpId(DAYS.A.date)].sort(), transactionIds: [...dayATransactions, ...standalone].sort() };
const depositsBefore = (snap.deposits ?? []).length;
const wrongBatch = { cashUpIds: Object.values(DAYS).map((day) => cashUpId(day.date)).sort(), transactionIds: [...verifiedLinked, ...standalone].sort() };
r = await post(manager, "deposit.lock", wrongBatch);
record(r.status === 409 && (snapshot().deposits ?? []).length === depositsBefore, "a batch that includes closed zero-cash days is refused", `${r.status} ${r.json.error ?? ""}`);
r = await post(manager, "deposit.lock", batch);
const banked = snapshot();
const deposit = (banked.deposits ?? [])[0];
record(
  r.status === 200 && deposit.cashUpIds.length === 1 && deposit.cashUpIds[0] === cashUpId(DAYS.A.date) && deposit.depositAmount === 380 + standalone.reduce((sum, id) => sum + Number(snap.financeTransactions.find((t) => t.id === id).actualCashReceived ?? 0), 0),
  "the deposit contains day A only (closed days and uncovered amounts are excluded)",
  `${r.status} cash-ups=${deposit?.cashUpIds} amount=${deposit?.depositAmount} ${r.json.error ?? ""}`,
);
const closedStillVerified = ["B", "C", "D"].every((key) => {
  const entry = banked.dailyCashUps.find((c) => c.id === cashUpId(DAYS[key].date));
  return entry.status === "verified" && !entry.depositId && recordsOf(DAYS[key].date).every((t) => t.status === "verified" && !t.depositId);
});
record(closedStillVerified, "closed zero-cash days and their records stay verified, never banked");
r = await post(manager, "deposit.lock", { cashUpIds: [], transactionIds: [] });
record(r.status === 409 && (snapshot().deposits ?? []).length === depositsBefore + 1, "with only closed zero-cash days left, no (R 0) deposit is created", `${r.status} ${r.json.error ?? ""}`);

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
