import { expect, test } from "@playwright/test";

import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Driver salaries through the server finance actions (tenant mode, LOCAL stack,
// synthetic @example.com identities). Uses business B only, so business A's
// finance journeys are unaffected.

test.describe.configure({ mode: "serial" });

const DRIVER_NAME = "UAT Driver B";

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const openSalaries = async (page) => {
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const panel = page.getByTestId("driver-salaries");
  await expect(panel.getByRole("heading", { name: "Driver salaries" })).toBeVisible();
  return panel;
};

test("Owner B: schedule from the profile, one payment, duplicate refused by the server, persisted after reload", async ({ page }) => {
  await signIn(page, "owner.b@example.com");

  // The schedule is set in the driver's profile (server: driver.save, then salary.arrangement_save).
  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  await page.getByRole("button", { name: `Edit profile: ${DRIVER_NAME}` }).click();
  const salary = page.getByTestId("driver-profile-salary");
  await salary.getByTestId("driver-profile-salary-enable").check();
  await salary.getByLabel("Salary amount (R)").fill("5200");
  await salary.getByLabel("Salary starts on").fill("2026-01-01");
  await page.getByTestId("driver-profile-form").getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText("Salary schedule saved. No expense was added.")).toBeVisible({ timeout: 30_000 });
  let panel = await openSalaries(page);

  const row = panel.getByTestId("salary-schedule-row").filter({ hasText: DRIVER_NAME });
  await row.getByRole("button", { name: "Record payment" }).click();
  const paymentForm = page.getByRole("form", { name: "Record salary payment" });
  await paymentForm.getByLabel("Pay month").fill("2026-09");
  await paymentForm.getByLabel("Date paid").fill("2026-09-30");
  await paymentForm.getByLabel("Bank transfer").check();
  await paymentForm.getByRole("button", { name: "Record payment" }).click();
  await expect(panel.getByText("Salary payment recorded and added to expenses once.")).toBeVisible({ timeout: 30_000 });

  // Server copy after a full reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  panel = await openSalaries(page);
  await expect(panel.getByTestId("salary-payment-row").filter({ hasText: `${DRIVER_NAME} / September 2026` })).toBeVisible();

  // A second payment for September: the form blocks it, and so does the server.
  await panel.getByTestId("salary-schedule-row").filter({ hasText: DRIVER_NAME }).getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("form", { name: "Record salary payment" }).getByLabel("Pay month").fill("2026-09");
  await expect(page.getByTestId("salary-duplicate-warning")).toBeVisible();

  const status = await page.evaluate(async () => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = JSON.parse(raw[1]).access_token;
    const workspace = await fetch("/api/business/workspace", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const response = await fetch(`/api/business/finance-actions?business=${workspace.businessId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "salary.payment_record",
        requestId: crypto.randomUUID(),
        expectedVersion: workspace.version,
        fields: { driverStaffId: "uat-drv-b-01", period: "2026-09", paidDate: "2026-10-01", amount: 5200, method: "bank", source: "business_bank" },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(status.status).toBe(409);
  expect(JSON.stringify(status.body)).toContain("already recorded");
});

// API helper as the signed-in person: always sends the version just loaded.
const act = (page, action, fields) =>
  page.evaluate(async ({ action, fields }) => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = JSON.parse(raw[1]).access_token;
    const workspace = await fetch("/api/business/workspace", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const response = await fetch("/api/business/finance-actions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, requestId: crypto.randomUUID(), expectedVersion: workspace.version, fields }),
    });
    return { status: response.status, body: await response.json() };
  }, { action, fields });

test("Owner B: a salary paid from Driver B's takings lowers that day's expected cash once", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const takings = { driverStaffId: "uat-drv-b-01", frequency: "daily", period: "2026-10-01", paidDate: "2026-10-01", amount: 250, method: "cash", source: "driver_takings" };
  const first = await act(page, "salary.payment_record", takings);
  expect(first.status).toBe(200);
  const again = await act(page, "salary.payment_record", { ...takings, amount: 100 });
  expect(again.status).toBe(409);
  expect(again.body.error).toContain("already recorded");
  // Business B's synthetic day checking for 2026-10-01 expects R 700; the hand-in now expects R 450.
  const handIn = await act(page, "cashup.record_handin", { cashUpId: "uat-cu-1-b", actualCashReceived: 450 });
  expect(handIn.status).toBe(200);
  expect(handIn.body.expectedCashIn).toBe(450);
  expect(handIn.body.variance).toBe(0);
  // Taking from a counted day is now refused.
  const late = await act(page, "salary.payment_record", { ...takings, period: "2026-10-02", amount: 50 });
  expect(late.status).toBe(409);
  expect(JSON.stringify(late.body)).toContain("counted");
});

test("Driver B never receives salary schedules, and sees only their own takings-funded salary", async ({ page }) => {
  await signIn(page, "driver.b@example.com");
  await expect(page.locator("button.module-button").filter({ hasText: "Money" })).toHaveCount(0);
  const leaked = await page.evaluate(async () => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = JSON.parse(raw[1]).access_token;
    const workspace = await fetch("/api/business/workspace", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const snapshot = workspace.snapshot ?? {};
    return {
      arrangements: snapshot.finance?.salaryArrangements ?? null,
      salarySources: (snapshot.financeTransactions ?? []).filter((record) => record.salaryPayment).map((record) => record.salaryPayment.source),
    };
  });
  expect(leaked).toEqual({ arrangements: null, salarySources: ["driver_takings"] });
});
