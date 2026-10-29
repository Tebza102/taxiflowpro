import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { listRecurringOccurrences } from "../../src/lib/recurringExpenseContract.js";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// The combined release stack (PRs #6-#12) on a hosted Vercel Preview whose
// backend is the ISOLATED test project (playwright.preview-test.config.mjs):
// salary in the driver profile, partial-save retry, recurring expenses and
// their duplicate protection, business/vehicle reports with custom dates and
// PDF/CSV downloads, permissions and business isolation. Synthetic accounts
// only; every run uses its own names so reruns never collide.

const REF = process.env.PREVIEW_TEST_REF;
const PASSWORD = process.env.PREVIEW_TEST_PASSWORD;
const PRODUCTION_REF = "vfxftviwteypasredjgm";
const SUPABASE_URL = `https://${REF}.supabase.co`;
const RUN = Date.now().toString(36).slice(-5);
const iso = (date) => date.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const TODAY = iso(new Date());
const START = iso(new Date(Date.now() - 62 * 86_400_000));
const MONTH = TODAY.slice(0, 7);
const RENT = `Hosted rent ${RUN}`;

test.describe.configure({ mode: "serial" });

let anonKey = null;
const tokens = {};
const token = async (email) => {
  if (tokens[email]) return tokens[email];
  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  tokens[email] = data.session.access_token;
  return tokens[email];
};
const api = async (request, email, path, { method = "GET", body } = {}) => {
  const response = await request.fetch(path, { method, headers: { authorization: `Bearer ${await token(email)}`, "content-type": "application/json" }, data: body });
  const buffer = await response.body();
  let json = null;
  try { json = JSON.parse(buffer.toString("utf8")); } catch { /* not JSON */ }
  return { status: response.status(), json, buffer };
};
const workspace = async (request, email) => (await api(request, email, "/api/business/workspace")).json;
const act = async (request, email, action, fields, { version = null, requestId = null } = {}) =>
  api(request, email, "/api/business/finance-actions", {
    method: "POST",
    body: { action, fields, requestId: requestId ?? crypto.randomUUID(), expectedVersion: version ?? (await workspace(request, email)).version },
  });
const reportQuery = (businessId, extra = "") => `/api/admin/reports/period?mode=live&business=${encodeURIComponent(businessId)}&period=custom&start=${START}&end=${TODAY}${extra}`;

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
};
const save = async (page, testId) => {
  const promise = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const file = await promise;
  return { filename: file.suggestedFilename(), buffer: await readFile(await file.path()) };
};
const expectReadablePdf = (buffer) => {
  const text = buffer.toString("latin1");
  expect(text.slice(0, 5)).toBe("%PDF-");
  expect(text).toMatch(/startxref\s+\d+\s+%%EOF\s*$/);
};

let businessA = null;
let businessB = null;

test("target: this build against the isolated test project, never production", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
  let bundle = "";
  for (const src of scripts) bundle += await (await request.get(src)).text();
  for (const chunk of new Set(bundle.match(/assets\/[A-Za-z0-9_-]+\.js/g) ?? [])) bundle += await (await request.get(`/${chunk}`)).text();
  expect(bundle).toContain(`${REF}.supabase.co`);
  expect(bundle).not.toContain(PRODUCTION_REF);
  // This build carries the whole stack: reports, recurring expenses, phone menu, file hand-off.
  for (const marker of ["Business and vehicle reports", "Recurring fixed expenses", "Open menu", "application/octet-stream"]) expect(bundle).toContain(marker);
  const refOf = (jwt) => {
    try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).ref; } catch { return null; }
  };
  anonKey = (bundle.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []).find((jwt) => refOf(jwt) === REF) ?? null;
  expect(anonKey).toBeTruthy();
  expect((await request.get("/api/business/workspace")).status()).toBe(401);
  expect((await request.get(reportQuery("x", "&scope=business&format=pdf"))).status()).toBe(401);
  businessA = (await workspace(request, "owner@example.com")).businessId;
  businessB = (await workspace(request, "owner.b@example.com")).businessId;
  expect(businessA).toBeTruthy();
  expect(businessB).toBeTruthy();
  expect(businessA).not.toBe(businessB);
});

test("driver profile salary: saved with the driver, no payment, Driver refused", async ({ page, request }) => {
  const NAME = `Hosted Driver ${RUN}`;
  const before = await workspace(request, "owner@example.com");
  const salaryPaymentsBefore = before.snapshot.financeTransactions.filter((record) => record.salaryPayment).length;

  await signIn(page, "owner@example.com");
  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  const form = page.getByTestId("driver-profile-form");
  await form.getByRole("button", { name: "Add driver" }).click();
  await form.getByLabel("Full name").fill(NAME);
  const salary = form.getByTestId("driver-profile-salary");
  await salary.getByTestId("driver-profile-salary-enable").check();
  await salary.getByLabel("Salary amount (R)").fill("4300");
  await salary.getByLabel("Salary starts on").fill(`${MONTH}-01`);
  await salary.getByLabel("When it is paid").selectOption("end");
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`${NAME} added to the driver roster. Salary schedule saved. No expense was added.`)).toBeVisible({ timeout: 60_000 });

  const after = await workspace(request, "owner@example.com");
  const driver = after.snapshot.drivers.find((item) => item.name === NAME);
  expect(driver).toBeTruthy();
  expect(after.snapshot.finance.salaryArrangements.filter((item) => item.driverStaffId === driver.staffId)).toEqual([
    expect.objectContaining({ amount: 4300, frequency: "monthly", revision: 1 }),
  ]);
  expect(after.snapshot.financeTransactions.filter((record) => record.salaryPayment).length).toBe(salaryPaymentsBefore);

  const refused = await act(request, "driver@example.com", "salary.arrangement_save", { driverStaffId: driver.staffId, amount: 1, frequency: "monthly", payMethod: "bank", startDate: `${MONTH}-01`, revision: 1 });
  expect(refused.status).toBe(403);
  expect((await workspace(request, "driver@example.com")).snapshot.finance?.salaryArrangements).toBeUndefined();
});

test("partial save: driver saved, salary fails, inputs kept; retry updates the same driver and saves the salary once", async ({ page, request }) => {
  const NAME = `Hosted Partial ${RUN}`;
  await signIn(page, "owner@example.com");
  let failed = false;
  await page.route("**/api/business/finance-actions**", async (route) => {
    const body = route.request().postDataJSON?.() ?? null;
    if (!failed && body?.action === "salary.arrangement_save") {
      failed = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Salary service unavailable (test)." }) });
    }
    return route.continue();
  });
  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  const form = page.getByTestId("driver-profile-form");
  await form.getByRole("button", { name: "Add driver" }).click();
  await form.getByLabel("Full name").fill(NAME);
  const salary = form.getByTestId("driver-profile-salary");
  await salary.getByTestId("driver-profile-salary-enable").check();
  await salary.getByLabel("Salary amount (R)").fill("3900");
  await salary.getByLabel("How often").selectOption("weekly");
  await salary.getByLabel("Salary starts on").fill(`${MONTH}-01`);
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`${NAME} added to the driver roster. The salary was not saved: Salary service unavailable (test).`)).toBeVisible({ timeout: 60_000 });
  expect(failed).toBe(true);
  await expect(salary.getByLabel("Salary amount (R)")).toHaveValue("3900");
  await expect(salary.getByLabel("How often")).toHaveValue("weekly");

  let ws = await workspace(request, "owner@example.com");
  expect(ws.snapshot.drivers.filter((driver) => driver.name === NAME)).toHaveLength(1);
  const staffId = ws.snapshot.drivers.find((driver) => driver.name === NAME).staffId;
  expect(ws.snapshot.finance.salaryArrangements.some((item) => item.driverStaffId === staffId)).toBe(false);

  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`${NAME} updated in the driver roster. Salary schedule saved. No expense was added.`)).toBeVisible({ timeout: 60_000 });
  ws = await workspace(request, "owner@example.com");
  expect(ws.snapshot.drivers.filter((driver) => driver.name === NAME)).toHaveLength(1);
  expect(ws.snapshot.finance.salaryArrangements.filter((item) => item.driverStaffId === staffId)).toEqual([
    expect.objectContaining({ amount: 3900, frequency: "weekly", revision: 1 }),
  ]);
});

test("recurring expense: overdue payment recorded in the app once; repeat, retried request and concurrent requests leave one payment each", async ({ page, request }) => {
  const saved = await act(request, "owner@example.com", "recurring.schedule_save", { description: RENT, category: "Rent", amount: 2100, frequency: "monthly", startDate: START, payMethod: "bank" });
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  const schedule = (await workspace(request, "owner@example.com")).snapshot.finance.recurringExpenses.find((item) => item.description === RENT);
  expect(schedule).toBeTruthy();

  await signIn(page, "owner@example.com");
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const row = page.getByTestId("recurring-row").filter({ hasText: RENT });
  await expect(row.getByTestId("recurring-overdue")).toBeVisible({ timeout: 60_000 });
  await row.locator('[data-status="overdue"]').first().getByRole("button", { name: "Record payment" }).click();
  const form = page.getByRole("form", { name: "Record recurring expense payment" });
  await expect(form.getByLabel("Amount paid (R)")).toHaveValue("2100");
  await form.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("recurring-feedback")).toContainText("Payment recorded and added to expenses once.", { timeout: 60_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });

  const payments = async () => (await workspace(request, "owner@example.com")).snapshot.financeTransactions.filter((record) => record.recurringPayment?.scheduleId === schedule.id);
  const first = await payments();
  expect(first).toHaveLength(1);
  const base = { scheduleId: schedule.id, paidDate: TODAY, amount: 2100, method: "bank", source: "business_bank" };

  const again = await act(request, "owner@example.com", "recurring.payment_record", { ...base, period: first[0].recurringPayment.period });
  expect(again.status).toBe(409);

  // Three monthly occurrences fall due in 62 days; the first was paid in the app.
  const all = listRecurringOccurrences({}, schedule, TODAY).occurrences.map((item) => item.period);
  expect(all).toHaveLength(3);
  expect(all[0]).toBe(first[0].recurringPayment.period);
  const periods = all.slice(1);
  const requestId = crypto.randomUUID();
  const firstTry = await act(request, "owner@example.com", "recurring.payment_record", { ...base, period: periods[0] }, { requestId });
  const retry = await act(request, "owner@example.com", "recurring.payment_record", { ...base, period: periods[0] }, { requestId });
  expect(firstTry.status, JSON.stringify(firstTry.json)).toBe(200);
  expect(retry.status).toBe(200);
  expect(retry.json.replayed).toBe(true);

  const version = (await workspace(request, "owner@example.com")).version;
  const results = await Promise.all([
    act(request, "owner@example.com", "recurring.payment_record", { ...base, period: periods[1] }, { version }),
    act(request, "owner@example.com", "recurring.payment_record", { ...base, period: periods[1] }, { version }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const recorded = (await payments()).map((record) => record.recurringPayment.period).sort();
  expect(recorded).toEqual([first[0].recurringPayment.period, ...periods].sort());
});

test("permissions and isolation: Driver and the other business are refused; another business's schedule is out of reach", async ({ request }) => {
  const formats = async (email, businessId) => {
    const result = {};
    for (const format of ["json", "csv", "pdf"]) result[format] = (await api(request, email, reportQuery(businessId, `&scope=business&format=${format}`))).status;
    return result;
  };
  expect(await formats("owner@example.com", businessA)).toEqual({ json: 200, csv: 200, pdf: 200 });
  expect(await formats("driver@example.com", businessA)).toEqual({ json: 403, csv: 403, pdf: 403 });
  expect(await formats("owner.b@example.com", businessA)).toEqual({ json: 403, csv: 403, pdf: 403 });
  expect(await formats("owner.b@example.com", businessB)).toEqual({ json: 200, csv: 200, pdf: 200 });

  expect((await act(request, "driver@example.com", "recurring.schedule_save", { description: "X", category: "Rent", amount: 1, frequency: "monthly", startDate: TODAY, payMethod: "bank" })).status).toBe(403);
  expect((await workspace(request, "driver@example.com")).snapshot.finance?.recurringExpenses).toBeUndefined();

  const schedule = (await workspace(request, "owner@example.com")).snapshot.finance.recurringExpenses.find((item) => item.description === RENT);
  const viewB = await workspace(request, "owner.b@example.com");
  expect(JSON.stringify(viewB.snapshot)).not.toContain(schedule.id);
  const cross = await act(request, "owner.b@example.com", "recurring.payment_record", { scheduleId: schedule.id, period: MONTH, paidDate: TODAY, amount: 1, method: "bank", source: "business_bank" });
  expect(cross.status).toBe(404);
  const vehicleA = (await workspace(request, "owner@example.com")).snapshot.vehicles[0];
  if (vehicleA) {
    expect((await act(request, "owner.b@example.com", "recurring.schedule_save", { description: "X", category: "Rent", amount: 1, frequency: "monthly", startDate: TODAY, payMethod: "bank", vehicleId: vehicleA.id })).status).toBe(404);
  }
});

test("reports with custom dates: screen, CSV and PDF agree; each recurring payment once; vehicle report keeps business costs out", async ({ page, request }) => {
  const report = (await api(request, "owner@example.com", reportQuery(businessA, "&scope=business&format=json"))).json;
  const schedule = (await workspace(request, "owner@example.com")).snapshot.finance.recurringExpenses.find((item) => item.description === RENT);
  const lines = report.transactions.filter((line) => line.id.startsWith(`txn-${schedule.id}-`));
  expect(lines).toHaveLength(3);
  expect(report.commitments.items.filter((item) => item.scheduleId === schedule.id && item.status === "paid")).toHaveLength(3);
  expect(report.reconciliation.ok).toBe(true);

  await signIn(page, "owner@example.com");
  await page.locator("button.module-button").filter({ hasText: "Reports" }).first().click();
  await page.getByTestId("period-report-period").selectOption("custom");
  await page.getByTestId("period-report-start").fill(START);
  await page.getByTestId("period-report-end").fill(TODAY);
  await page.getByTestId("period-report-view").click();
  await expect(page.getByTestId("period-report-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("period-report-notes")).toContainText("Totals reconcile with the lines.");

  const csv = (await save(page, "period-report-download-csv")).buffer.toString("utf8").split(/\r?\n/);
  const header = csv.findIndex((row) => row.startsWith("Date,Type,Category"));
  const expenseCents = csv.slice(header + 1).filter((row) => row.includes(",Expense,")).reduce((sum, row) => sum + Math.round(Number(row.split(",").at(-1)) * 100), 0);
  expect(expenseCents).toBe(report.totals.expenseCents);
  expect(csv.filter((row) => row.includes(`${RENT} /`) && row.includes(",Expense,"))).toHaveLength(3);
  expect(csv).toContain("Reconciles,yes");
  const pdf = await save(page, "period-report-download-pdf");
  expect(pdf.filename).toBe(`taxiflow-business-${START}-to-${TODAY}.pdf`);
  expectReadablePdf(pdf.buffer);
  await expect(page.getByTestId("period-report-download-done")).toContainText("PDF ready");

  const vehicle = (await workspace(request, "owner@example.com")).snapshot.vehicles[0];
  test.skip(!vehicle, "Company A has no vehicle in the test project.");
  await page.getByText("Individual vehicle").click();
  await page.getByTestId("period-report-vehicle").selectOption({ label: vehicle.registration });
  await page.getByTestId("period-report-view").click();
  await expect(page.getByTestId("period-report-selection")).toContainText("Vehicle report");
  await expect(page.getByTestId("period-report-transactions")).not.toContainText(RENT);
  expectReadablePdf((await save(page, "period-report-download-pdf")).buffer);
  const vehicleCsv = (await save(page, "period-report-download-csv")).buffer.toString("utf8");
  expect(vehicleCsv).not.toContain(RENT);
  expect(vehicleCsv).toContain("Reconciles,yes");
});
