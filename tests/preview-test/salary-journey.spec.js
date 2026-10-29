import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Driver salaries on a hosted Vercel Preview whose backend is the ISOLATED test
// project (playwright.preview-test.config.mjs). Company A, synthetic accounts.
// Each run uses its own dates, so reruns never collide with earlier data.

const REF = process.env.PREVIEW_TEST_REF;
const PASSWORD = process.env.PREVIEW_TEST_PASSWORD;
const PRODUCTION_REF = "vfxftviwteypasredjgm";
const SUPABASE_URL = `https://${REF}.supabase.co`;
const DRIVER_STAFF_ID = "pv-drv-01";
// A run-unique past date (one per minute over ~8 years), always a Wednesday so
// its week's Monday is in the same month.
const runDay = (() => {
  const base = Date.UTC(2015, 0, 7); // a Wednesday
  const weeks = Math.floor(Date.now() / 60_000) % 400;
  return new Date(base + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
})();
const runMonday = new Date(Date.parse(`${runDay}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

let anonKey = null;
const tokens = {};
const token = async (email) => {
  if (tokens[email]) return tokens[email];
  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  tokens[email] = { token: data.session.access_token };
  return tokens[email];
};
const api = async (request, email, path, { method = "GET", body } = {}) => {
  const who = await token(email);
  const response = await request.fetch(path, { method, headers: { authorization: `Bearer ${who.token}`, "content-type": "application/json" }, data: body });
  let json = {};
  try { json = await response.json(); } catch { /* not JSON */ }
  return { status: response.status(), json };
};
const workspace = (request, email) => api(request, email, "/api/business/workspace");
const act = async (request, email, action, fields) => {
  const { json: ws } = await workspace(request, email);
  return api(request, email, "/api/business/finance-actions", { method: "POST", body: { action, requestId: crypto.randomUUID(), expectedVersion: ws.version, fields } });
};

test("target: the Preview runs this build against the isolated test project, never production", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
  let bundle = "";
  for (const src of scripts) bundle += await (await request.get(src)).text();
  for (const chunk of new Set(bundle.match(/assets\/[A-Za-z0-9_-]+\.js/g) ?? [])) bundle += await (await request.get(`/${chunk}`)).text();
  expect(bundle).toContain(`${REF}.supabase.co`);
  expect(bundle).not.toContain(PRODUCTION_REF);
  // This build has the salary section.
  expect(bundle).toContain("Driver salaries");
  const refOf = (jwt) => {
    try {
      return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).ref;
    } catch {
      return null;
    }
  };
  anonKey = (bundle.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []).find((jwt) => refOf(jwt) === REF) ?? null;
  expect(anonKey).toBeTruthy();
  expect((await request.get("/api/business/workspace")).status()).toBe(401);
  const owner = await workspace(request, "owner@example.com");
  expect(owner.status).toBe(200);
  expect(owner.json.role).toBe("Owner");
});

test("permissions: a Driver cannot record salaries", async ({ request }) => {
  const refused = await act(request, "driver@example.com", "salary.payment_record", {
    driverStaffId: DRIVER_STAFF_ID, frequency: "daily", period: runDay, paidDate: runDay, amount: 1, method: "bank", source: "business_bank",
  });
  expect(refused.status).toBe(403);
});

test("bank salary: one expense, duplicate refused, never in the driver's hand-in; takings salary lowers it once", async ({ request }) => {
  const bank = { driverStaffId: DRIVER_STAFF_ID, frequency: "daily", period: runDay, paidDate: runDay, amount: 400, method: "bank", source: "business_bank" };
  const first = await act(request, "owner@example.com", "salary.payment_record", bank);
  expect(first.status, JSON.stringify(first.json)).toBe(200);
  const duplicate = await act(request, "owner@example.com", "salary.payment_record", { ...bank, amount: 401 });
  expect(duplicate.status).toBe(409);
  expect(duplicate.json.error).toContain("already recorded");

  const takings = { driverStaffId: DRIVER_STAFF_ID, frequency: "weekly", period: runMonday, paidDate: runDay, amount: 250, method: "cash", source: "driver_takings" };
  const fromTakings = await act(request, "owner@example.com", "salary.payment_record", takings);
  expect(fromTakings.status, JSON.stringify(fromTakings.json)).toBe(200);

  // The driver's day holds only the takings salary: expected cash = -250 (not -500,
  // and the R 400 bank salary is not deducted).
  const submitted = await act(request, "driver@example.com", "cashup.submit", { workDate: runDay });
  expect(submitted.status, JSON.stringify(submitted.json)).toBe(200);
  expect(submitted.json.expectedCashIn).toBe(-250);

  // Scoped views: the driver sees only the takings salary; no schedules.
  const driverView = await workspace(request, "driver@example.com");
  const salaries = (driverView.json.snapshot?.financeTransactions ?? []).filter((record) => record.salaryPayment);
  // Hosted data persists across runs: every salary the driver can see is a
  // takings-funded one (never a bank or business-cash salary), including this run's.
  expect(salaries.length).toBeGreaterThan(0);
  expect(salaries.every((record) => record.salaryPayment.source === "driver_takings")).toBe(true);
  expect(salaries.some((record) => record.id === fromTakings.json.recordId)).toBe(true);
  expect(salaries.some((record) => record.id === first.json.recordId)).toBe(false);
  expect(driverView.json.snapshot?.finance?.salaryArrangements).toBeUndefined();
});

test("Owner downloads the month's expense report: both salaries once each, totals reconcile", async ({ page }) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const report = page.getByTestId("expense-report");
  await report.getByLabel("Month").fill(runDay.slice(0, 7));
  const downloadPromise = page.waitForEvent("download");
  await report.getByRole("button", { name: "Download expense report (CSV)" }).click();
  const csv = await readFile(await (await downloadPromise).path(), "utf8");
  const salaryLines = csv.split("\r\n").filter((line) => line.includes("Driver salary /") && (line.includes(",400.00") || line.includes(",250.00")));
  expect(salaryLines.length).toBe(2);
  expect(csv).toContain("Reconciles,yes");
  const value = (label) => Number(csv.split("\r\n").find((line) => line.startsWith(label)).split(",").at(-1));
  expect(Math.round((value("Driver salaries") + value("Other expenses")) * 100)).toBe(Math.round(value("Total expenses") * 100));
  expect(value("  of which paid from drivers' takings")).toBeGreaterThanOrEqual(250);
});
