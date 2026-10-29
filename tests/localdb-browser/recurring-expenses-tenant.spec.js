import { expect, test } from "@playwright/test";

import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { listRecurringOccurrences } from "../../src/lib/recurringExpenseContract.js";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Recurring fixed expenses in tenant mode (LOCAL stack, synthetic identities,
// business B). The server decides: duplicates across retries, refreshes and
// concurrent requests, permissions, business isolation, persistence, and the
// schedule -> payment -> refresh -> report flow read back from the server.

test.describe.configure({ mode: "serial" });

const iso = (date) => date.toLocaleDateString("en-CA");
const TODAY = iso(new Date());
const START = iso(new Date(Date.now() - 62 * 86_400_000));
const NAME = "Yard rent B";

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

// Requests as the signed-in person. `version` pins expectedVersion (concurrency
// test); `requestId` repeats an id (retry test).
const api = (page, method, path, body = null, { version = null, requestId = null } = {}) =>
  page.evaluate(async ({ method, path, body, version, requestId }) => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = JSON.parse(raw[1]).access_token;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let payload = body;
    if (body?.action) {
      const expectedVersion = version ?? (await fetch("/api/business/workspace", { headers }).then((r) => r.json())).version;
      payload = { ...body, requestId: requestId ?? crypto.randomUUID(), expectedVersion };
    }
    const response = await fetch(path, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: json, text };
  }, { method, path, body, version, requestId });
const workspace = async (page) => (await api(page, "GET", "/api/business/workspace")).body;
const finance = (page, action, fields, options) => api(page, "POST", "/api/business/finance-actions", { action, fields }, options);
const scheduleOf = async (page) => (await workspace(page)).snapshot.finance.recurringExpenses.find((item) => item.description === NAME);

test("Owner B: schedule -> overdue -> record payment in the app -> refresh -> still one payment", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const saved = await finance(page, "recurring.schedule_save", { description: NAME, category: "Rent", amount: 2100, frequency: "monthly", startDate: START, payMethod: "bank" });
  expect(saved.status, saved.text).toBe(200);
  const before = (await workspace(page)).snapshot.financeTransactions.length;

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const row = page.getByTestId("recurring-row").filter({ hasText: NAME });
  await expect(row.getByTestId("recurring-overdue")).toBeVisible({ timeout: 30_000 });
  await row.locator('[data-status="overdue"]').first().getByRole("button", { name: "Record payment" }).click();
  const form = page.getByRole("form", { name: "Record recurring expense payment" });
  await expect(form.getByLabel("Amount paid (R)")).toHaveValue("2100");
  await form.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("recurring-feedback")).toContainText("Payment recorded and added to expenses once.", { timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  const after = (await workspace(page)).snapshot;
  expect(after.financeTransactions.length).toBe(before + 1);
  const schedule = await scheduleOf(page);
  expect(after.financeTransactions.filter((record) => record.recurringPayment?.scheduleId === schedule.id)).toHaveLength(1);
});

test("duplicates: a new request, a retried request id and two concurrent requests each leave one payment", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const schedule = await scheduleOf(page);
  const paid = (await workspace(page)).snapshot.financeTransactions.find((record) => record.recurringPayment?.scheduleId === schedule.id);
  const base = { scheduleId: schedule.id, paidDate: TODAY, amount: 2100, method: "bank", source: "business_bank" };

  // Same occurrence again (a refresh or another device): refused.
  const again = await finance(page, "recurring.payment_record", { ...base, period: paid.recurringPayment.period });
  expect(again.status).toBe(409);
  expect(again.body.error).toContain("already recorded");

  // A schedule starting 62 days ago has exactly three monthly occurrences due by
  // today (two months never exceed 62 days); the first was paid in the app.
  const periods = listRecurringOccurrences({}, schedule, TODAY).occurrences.map((item) => item.period);
  expect(periods).toHaveLength(3);
  expect(periods[0]).toBe(paid.recurringPayment.period);
  const nextPeriod = periods[1];

  // Retry of the same request id: replayed, not applied twice.
  const requestId = crypto.randomUUID();
  const firstTry = await finance(page, "recurring.payment_record", { ...base, period: nextPeriod }, { requestId });
  const retry = await finance(page, "recurring.payment_record", { ...base, period: nextPeriod }, { requestId });
  expect(firstTry.status, firstTry.text).toBe(200);
  expect(retry.status).toBe(200);
  expect(retry.body.replayed).toBe(true);

  // Two requests at once from the same loaded version, for the third occurrence.
  const version = (await workspace(page)).version;
  const period = periods[2];
  const results = await Promise.all([
    finance(page, "recurring.payment_record", { ...base, period }, { version }),
    finance(page, "recurring.payment_record", { ...base, period }, { version }),
  ]);
  const statuses = results.map((result) => result.status).sort();
  expect(statuses[0]).toBe(200);
  expect(statuses[1]).toBe(409);

  const records = (await workspace(page)).snapshot.financeTransactions.filter((record) => record.recurringPayment?.scheduleId === schedule.id);
  expect(records.map((record) => record.recurringPayment.period).sort()).toEqual([paid.recurringPayment.period, nextPeriod, period].sort());
});

test("reports from the server: each payment once, commitments separate, business-wide rent in no vehicle report; CSV reconciles", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const schedule = await scheduleOf(page);
  const query = `mode=live&scope=business&period=custom&start=${START}&end=${TODAY}`;
  const business = (await api(page, "GET", `/api/admin/reports/period?${query}&format=json`)).body;
  const lines = business.transactions.filter((line) => line.id.startsWith(`txn-${schedule.id}-`));
  expect(lines).toHaveLength(3);
  expect(new Set(lines.map((line) => line.id)).size).toBe(3);
  const items = business.commitments.items.filter((item) => item.scheduleId === schedule.id);
  expect(items.filter((item) => item.status === "paid")).toHaveLength(3);
  expect(business.reconciliation.ok).toBe(true);
  expect(business.unallocatedBreakdown.some((group) => group.category === "Rent")).toBe(true);

  const csv = (await api(page, "GET", `/api/admin/reports/period?${query}&format=csv`)).text.split(/\r?\n/);
  const header = csv.findIndex((row) => row.startsWith("Date,Type,Category"));
  const expenseCents = csv.slice(header + 1).filter((row) => row.includes(",Expense,")).reduce((sum, row) => sum + Math.round(Number(row.split(",").at(-1)) * 100), 0);
  expect(expenseCents).toBe(business.totals.expenseCents);
  expect(csv.some((row) => row.startsWith("Scheduled commitments (not expenses; not in any total)"))).toBe(true);
  const pdf = await api(page, "GET", `/api/admin/reports/period?${query}&format=pdf`);
  expect(pdf.status).toBe(200);

  for (const vehicle of (await workspace(page)).snapshot.vehicles) {
    const report = (await api(page, "GET", `/api/admin/reports/period?mode=live&scope=vehicle&vehicle=${encodeURIComponent(vehicle.id)}&period=custom&start=${START}&end=${TODAY}`)).body;
    expect(report.transactions.some((line) => line.id.startsWith(`txn-${schedule.id}-`))).toBe(false);
    expect(report.commitments.items.some((item) => item.scheduleId === schedule.id)).toBe(false);
  }
});

test("permissions and isolation: a Driver is refused and sees no schedules; another business's vehicle and schedules are out of reach", async ({ page }) => {
  await signIn(page, "driver.b@example.com");
  const refused = await finance(page, "recurring.schedule_save", { description: "X", category: "Rent", amount: 1, frequency: "monthly", startDate: TODAY, payMethod: "bank" });
  expect(refused.status).toBe(403);
  expect((await workspace(page)).snapshot.finance?.recurringExpenses).toBeUndefined();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });

  await signIn(page, "owner.b@example.com");
  const otherVehicle = await finance(page, "recurring.schedule_save", { description: "X", category: "Rent", amount: 1, frequency: "monthly", startDate: TODAY, payMethod: "bank", vehicleId: "uat-veh-01" });
  expect(otherVehicle.status).toBe(404);
  const scheduleId = (await scheduleOf(page)).id;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });

  await signIn(page, "owner@example.com");
  const view = await workspace(page);
  expect(JSON.stringify(view.snapshot)).not.toContain(scheduleId);
  const cross = await finance(page, "recurring.payment_record", { scheduleId, period: TODAY.slice(0, 7), paidDate: TODAY, amount: 1, method: "bank", source: "business_bank" });
  expect(cross.status).toBe(404);
});
